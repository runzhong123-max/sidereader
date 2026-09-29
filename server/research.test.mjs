import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, coverage } from "./catalog.mjs";
import { research, isDeep, wantsObjects } from "./research.mjs";
import { maintainObjects } from "./project-tools.mjs";
import { buildTutorMessages } from "./tutor-context.mjs";
import { mergeProjectUpdate } from "../src/project-updates.mjs";
const chunks = Array.from({ length: 80 }, (_, i) => ({
  id: `book:${i + 1}`,
  sourceId: "book",
  title: "教材",
  page: i + 1,
  text:
    i % 10 === 0
      ? `第${i / 10 + 1}章 主题${i / 10 + 1}\n本章定义与实践。`
      : `定义与例子 第${i + 1}页，评估与验证。`,
}));
test("current-turn maintenance refusals override deep research without misreading 'not only'", () => {
  for (const question of [
    "请深度研究，暂不修改学习对象。",
    "先分析材料，不要生成图谱或关卡。",
    "这次不需要更新知识图谱。",
    "不用创建学习路径，先给文字规划。",
    "Do not create learning objects; provide a research overview.",
  ]) {
    const input = { question, mode: "project", researchMode: "deep" };
    assert.equal(isDeep(input), true, question);
    assert.equal(wantsObjects(input), false, question);
  }
  for (const question of [
    "不要只生成图谱，也要说明关卡之间的依赖。",
    "不只是更新关卡，还需要给出学习规划。",
    "不是不要生成图谱，请研究后给出提案。",
    "不要停止更新图谱。",
    "Don't just create learning objects; explain them too.",
  ])
    assert.equal(
      wantsObjects({ question, mode: "project", researchMode: "deep" }),
      true,
      question,
    );
  assert.equal(
    wantsObjects({
      question: "现在生成整体学习规划",
      mode: "project",
      history: [{ role: "user", content: "上一轮暂不修改学习对象" }],
    }),
    true,
    "a previous refusal is not a persistent mode",
  );
});

test("opted-out deep research still reads evidence but cannot load maintenance skills or return proposals", async () => {
  const seen = [];
  let rounds = 0;
  const result = await research(
    {
      question: "深度研究教材并给出总体规划，暂不修改学习对象",
      mode: "project",
      chunks,
    },
    {
      complete: async (messages, json) => {
        seen.push({ messages, json });
        if (messages[0].content.includes("有预算的资料研究"))
          return JSON.stringify(
            ++rounds === 1
              ? {
                  actions: [
                    { tool: "read_skill", name: "knowledge-graph" },
                    {
                      tool: "read_pages",
                      sourceId: "book",
                      startPage: 72,
                      endPage: 73,
                    },
                  ],
                  gaps: ["仍需部署实例"],
                }
              : { finish: true, gaps: ["材料尚未覆盖部署实例"] },
          );
        assert.equal(json, false);
        return "文字规划与实践建议 [1]。目前材料尚未覆盖部署实例。";
      },
    },
  );
  assert.equal(result.research.mode, "deep");
  assert.ok(result.evidence.some((c) => c.page === 72));
  assert.equal(result.proposal, undefined);
  assert.ok(
    !result.research.trace.some((t) =>
      ["read_skill", "maintain_graph", "maintain_path"].includes(t.tool),
    ),
  );
  for (const request of seen.slice(0, -1)) {
    const context = JSON.parse(request.messages.at(-1).content);
    assert.equal(context.objectMaintenanceAllowed, false);
    assert.deepEqual(context.skills, []);
  }
  const finalInstructions = seen
    .at(-1)
    .messages.filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  assert.match(finalInstructions, /不生成知识图谱或关卡更新提案/);
  assert.match(finalInstructions, /不得输出 \[research\.gaps\]/);
  assert.match(finalInstructions, /需要说明缺口时用自然中文/);
});
test("catalog identifies chapters, ignores references and running headers; changed text invalidates cache", () => {
  const data = [
    ...chunks,
    {
      id: "other",
      sourceId: "repo",
      title: "仓库",
      page: 1,
      path: "docs/start.md",
      text: "# Guide",
    },
  ];
  data[4] = { ...data[4], text: "4 第1章主题\n参见第8章。" };
  const a = buildCatalog(data);
  assert.equal(a.sections.length, 9);
  assert.equal(a.totalPages, 81);
  assert.equal(buildCatalog(data).cacheHit, true);
  assert.notEqual(
    buildCatalog(data.map((c, i) => (i ? c : { ...c, text: "changed" }))).key,
    a.key,
  );
  const c = coverage(a, [data[0], data[70]]);
  assert.equal(c.sampledSections, 2);
  assert.equal(c.sampledPages, 2);
});
test("deep research reads new evidence and checks results before bounded synthesis", async () => {
  let rounds = 0;
  const messages = [];
  const result = await research(
    { question: "整体学习规划", mode: "project", chunks },
    {
      complete: async (m, json, options) => {
        messages.push(m);
        options.onUsage({ prompt_tokens: 100, completion_tokens: 50 });
        if (m[0].content.includes("有预算的资料研究"))
          return JSON.stringify(
            ++rounds === 1
              ? {
                  actions: [
                    {
                      tool: "read_pages",
                      sourceId: "book",
                      startPage: 72,
                      endPage: 73,
                    },
                  ],
                  gaps: ["补读验证"],
                }
              : { finish: true, gaps: [] },
          );
        return JSON.stringify({ answer: "阶段与验证 [1]", tools: [] });
      },
    },
  );
  assert.equal(rounds, 2);
  assert.equal(result.research.metrics.calls, 3);
  assert.equal(result.research.metrics.inputTokens, 300);
  assert.ok(result.evidence.some((c) => c.page === 72));
  assert.equal(result.research.coverage.sampledSections, 8);
  assert.ok(messages[1].at(-1).content.includes("book:72"));
  assert.ok(result.research.trace.some((t) => t.tool === "read_pages"));
  assert.equal(result.research.stopReason, "sufficient");
});
test("reading evidence pins current page; planner can stop without retrieval expansion", async () => {
  const result = await research(
    {
      question: "解释这里",
      mode: "learning",
      chunks,
      anchor: { sourceId: "book", page: 79 },
      visibleText: "第79页",
    },
    { complete: async (m, json) => (json ? '{"finish":true}' : "讲解[1]") },
  );
  assert.equal(result.evidence[0].page, 79);
  assert.equal(result.research.metrics.calls, 2);
  assert.equal(result.research.mode, "qa");
  assert.equal(result.proposal, undefined);
});
test("repeated tool actions stop, invalid arguments do not read outside corpus, and cancellation propagates", async () => {
  const result = await research(
    { question: "全面规划", mode: "project", chunks },
    {
      complete: async (m) =>
        m[0].content.includes("有预算")
          ? '{"actions":[{"tool":"read_pages","sourceId":"missing","startPage":1}]}'
          : '{"answer":"范围有限","tools":[]}',
    },
  );
  assert.ok(result.research.metrics.calls <= 4);
  assert.ok(result.evidence.every((e) => e.sourceId === "book"));
  assert.equal(result.research.stopReason, "no-new-actions");
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    research(
      { question: "x", chunks },
      { signal: c.signal, complete: async () => "" },
    ),
    /abort/i,
  );
});
test("maintenance rejects invented citations and cycles; merge preserves completion/layout and is idempotent", () => {
  const state = {
    concepts: [{ id: "old", name: "概念", x: 18, y: 22, links: [] }],
    stages: [{ id: "one", title: "第一关", done: true }],
  };
  const p = maintainObjects(
    [
      {
        tool: "maintain_graph",
        nodes: [
          {
            id: "new",
            name: "概念",
            description: "新解释",
            citations: [1],
            links: ["ghost"],
          },
          { id: "bad", name: "编造", citations: [999] },
        ],
      },
      {
        tool: "maintain_path",
        stages: [
          {
            id: "one",
            title: "第一关",
            deliverable: "实现",
            check: "测试",
            citations: [1],
            prerequisites: ["two"],
          },
          {
            id: "two",
            title: "第二关",
            deliverable: "验证",
            check: "对照",
            citations: [1],
            prerequisites: ["one"],
          },
        ],
      },
    ],
    chunks,
    state,
  );
  assert.equal(p.concepts.length, 1);
  assert.deepEqual(p.concepts[0].links, []);
  assert.ok(p.warnings.length);
  assert.equal(p.stages[1].prerequisites.length, 0);
  const merged = mergeProjectUpdate(state, p);
  assert.equal(merged.concepts[0].id, "old");
  assert.equal(merged.concepts[0].x, 18);
  assert.equal(merged.stages[0].done, true);
  assert.deepEqual(mergeProjectUpdate(merged, p), merged);
});
test("partial object maintenance preserves complete existing associations when fields are omitted", () => {
  const ids = Array.from({ length: 15 }, (_, i) => `dependency-${i}`);
  const state = {
    concepts: [
      { id: "generalization", name: "泛化能力", links: ids },
      ...ids.map((id) => ({ id, name: id, links: [] })),
    ],
    stages: [
      { id: "practice", title: "实践", prerequisites: ids },
      ...ids.map((id) => ({ id, title: id, prerequisites: [] })),
    ],
  };
  const snapshot = structuredClone(state);
  const proposal = maintainObjects(
    [
      {
        tool: "maintain_graph",
        nodes: [
          {
            id: "model-alias",
            name: "泛化能力",
            description: "修正后的说明",
            citations: [1],
          },
        ],
      },
      {
        tool: "maintain_path",
        stages: [
          {
            id: "stage-alias",
            title: "实践",
            deliverable: "实现",
            check: "验证",
            citations: [1],
          },
        ],
      },
    ],
    chunks,
    state,
  );
  assert.equal(proposal.concepts[0].id, "generalization");
  assert.deepEqual(proposal.concepts[0].links, ids);
  assert.equal(proposal.stages[0].id, "practice");
  assert.deepEqual(proposal.stages[0].prerequisites, ids);
  assert.deepEqual(state, snapshot);
});
test("explicit empty associations clear them while malformed fields preserve existing values", () => {
  const state = {
    concepts: [
      { id: "a", name: "A", links: ["b"] },
      { id: "b", name: "B", links: [] },
    ],
    stages: [
      { id: "one", title: "One", prerequisites: ["two"] },
      { id: "two", title: "Two", prerequisites: [] },
    ],
  };
  const calls = (references) => [
    {
      tool: "maintain_graph",
      nodes: [
        { id: "a", name: "A", links: references, citations: [1] },
        { id: "new", name: "New", citations: [1] },
      ],
    },
    {
      tool: "maintain_path",
      stages: [
        {
          id: "one",
          title: "One",
          deliverable: "实现",
          check: "验证",
          prerequisites: references,
          citations: [1],
        },
      ],
    },
  ];
  const cleared = maintainObjects(calls([]), chunks, state);
  assert.deepEqual(cleared.concepts[0].links, []);
  assert.deepEqual(cleared.stages[0].prerequisites, []);
  assert.deepEqual(cleared.concepts[1].links, []);
  const invalid = maintainObjects(calls(null), chunks, state);
  assert.deepEqual(invalid.concepts[0].links, ["b"]);
  assert.deepEqual(invalid.stages[0].prerequisites, ["two"]);
  assert.ok(invalid.warnings.length);
});
test("tutor context includes bounded existing relationship IDs and signals omitted links", () => {
  const references = Array.from({ length: 15 }, (_, i) => `id-${i}`);
  const prepared = buildTutorMessages({
    question: "只修改泛化能力的说明，保留关联",
    mode: "project",
    projectState: {
      concepts: Array.from({ length: 35 }, (_, i) => ({
        id: `c-${i}`,
        name: `Concept ${i}`,
        links: references,
      })),
      stages: Array.from({ length: 25 }, (_, i) => ({
        id: `s-${i}`,
        title: `Stage ${i}`,
        prerequisites: references,
        deliverable: "实现",
        check: "验证",
      })),
    },
  });
  const { projectState } = JSON.parse(prepared.messages.at(-1).content).context;
  assert.equal(projectState.concepts.length, 30);
  assert.equal(projectState.stages.length, 20);
  assert.deepEqual(projectState.concepts[0].links, references.slice(0, 12));
  assert.equal(projectState.concepts[0].linksOmitted, 3);
  assert.deepEqual(
    projectState.stages[0].prerequisites,
    references.slice(0, 12),
  );
  assert.equal(projectState.stages[0].prerequisitesOmitted, 3);
  assert.equal(projectState.stages[0].deliverable, "实现");
  assert.match(projectState.note, /保留完整原关联/);
});
test("project planning auto-routes deeply while ordinary reading stays local", () => {
  assert.equal(isDeep({ question: "纵览这个领域", mode: "project" }), true);
  assert.equal(
    isDeep({ question: "这里的公式什么意思", mode: "learning" }),
    false,
  );
  assert.equal(
    isDeep({
      question: "对比这两种优化方法",
      mode: "project",
      researchMode: "deep",
    }),
    true,
  );
});

test("deep research cannot declare success from initial samples alone", async () => {
  const result = await research(
    { question: "总体规划", mode: "project", chunks },
    {
      complete: async (m) =>
        m[0].content.includes("有预算")
          ? '{"finish":true}'
          : '{"answer":"尚需验证","tools":[]}',
    },
  );
  assert.equal(result.research.stopReason, "budget");
  assert.equal(result.research.metrics.calls, 4);
  assert.ok(result.research.gaps.some((g) => g.includes("尚未主动补读")));
});
test("optional embedding receives at most 96 candidates, never an unbounded cold corpus", async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    ...chunks[0],
    id: `x${i}`,
    page: i + 1,
  }));
  let count = 0;
  await research(
    { question: "解释这里", mode: "learning", chunks: many },
    {
      complete: async (m, json) => (json ? '{"finish":true}' : "回答"),
      semantic: async (candidates) => {
        count = candidates.length;
        return candidates.slice(0, 2);
      },
    },
  );
  assert.ok(count > 0 && count <= 96);
});
