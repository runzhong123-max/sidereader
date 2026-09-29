import { test } from "node:test";
import assert from "node:assert/strict";
import { createConversationGraphTools, conversationGraphToolDefinition } from "./conversation-graph-tools.mjs";
import { research, wantsObjects } from "./research.mjs";

const action = (extra = {}) => ({
  tool: "create_conversation_graph", title: "二分查找讨论",
  nodes: [
    { id: "ordered", name: "有序前提", description: "对话中的数组有序。", links: [] },
    { id: "halve", name: "缩小区间", description: "比较中间值后舍弃不可能的一半。", links: ["ordered"] },
  ],
  ...extra,
});
const evidence = [{ sourceId: "book", page: 12, title: "算法", text: "数组有序使得二分查找能够缩小区间。", id: "book:12" }];

test("a dialogue graph needs no textbook citation and creates independent namespaced concepts", () => {
  const tools = createConversationGraphTools();
  const receipt = tools.execute(action());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.basis, "conversation");
  assert.match(receipt.id, /^dialog-graph-/);
  const graph = tools.conversationGraphs()[0];
  assert.equal(graph.title, "二分查找讨论");
  assert.deepEqual(graph.concepts.map((concept) => concept.id), Object.values(receipt.nodeIds));
  assert.deepEqual(graph.concepts[1].links, [receipt.nodeIds.ordered]);
  assert.deepEqual(graph.concepts[0].anchors, []);
  assert.ok(graph.concepts.every((concept) => concept.id.startsWith(`${graph.id}:`)));
  graph.concepts[0].name = "edited";
  assert.equal(tools.conversationGraphs()[0].concepts[0].name, "有序前提");
  assert.equal(conversationGraphToolDefinition.parameters.properties.nodes.maxItems, 20);
});

test("graph tool is idempotent and graph ids cannot collide with another conversation or graph", () => {
  const one = createConversationGraphTools(), two = createConversationGraphTools();
  const first = one.execute(action());
  assert.equal(one.execute(action()).id, first.id);
  assert.equal(one.execute(action()).replayed, true);
  const second = one.execute(action({ title: "另一张对话图谱" }));
  assert.notEqual(first.nodeIds.ordered, second.nodeIds.ordered);
  assert.notEqual(two.execute(action()).nodeIds.ordered, first.nodeIds.ordered);
  assert.equal(one.execute(action({ title: "第三张" })).error.code, "graph_budget");
  assert.equal(one.execute(action()).id, first.id, "replay remains available once the budget is full");
  assert.equal(one.conversationGraphs().length, 2);
});

test("invalid nodes, dangling global links and excessive input fail atomically with exact fields", () => {
  const base = action().nodes[0];
  const invalid = [
    action({ nodes: [] }), action({ nodes: Array(21).fill(base) }), action({ title: "x".repeat(121) }),
    action({ nodes: [base, base] }), action({ nodes: [null] }),
    action({ nodes: [{ ...base, links: ["chapter-other-concept"] }] }),
    action({ nodes: [{ ...base, links: ["ordered"] }] }),
    action({ nodes: [base, { ...action().nodes[1], links: ["ordered", "ordered"] }] }),
    action({ nodes: [{ ...base, id: "global:concept" }] }),
    action({ nodes: [{ ...base, description: "x".repeat(1001) }] }),
    action({ scopeNodeId: "invented-chapter" }),
  ];
  const tools = createConversationGraphTools();
  for (const call of invalid) {
    const result = tools.execute(call);
    assert.equal(result.ok, false, JSON.stringify(call));
    assert.equal(result.error.code, "invalid_arguments");
    assert.ok(result.error.issues.length);
  }
  assert.deepEqual(tools.conversationGraphs(), []);
});

test("optional textbook anchors must match actually read current evidence", () => {
  const nodes = action().nodes;
  const linked = action({ nodes: [{ ...nodes[0], anchors: [{ sourceId: "book", page: 12 }] }, nodes[1]] });
  assert.equal(createConversationGraphTools().execute(linked).ok, false);
  assert.equal(createConversationGraphTools().execute(linked, [{ ...evidence[0], page: 11 }]).ok, false);
  const tools = createConversationGraphTools();
  assert.equal(tools.execute(linked, evidence).ok, true);
  assert.deepEqual(tools.conversationGraphs()[0].concepts[0].anchors, [{ sourceId: "book", page: 12, title: "算法" }]);
  const spoof = action({ nodes: [{ ...nodes[0], anchors: [{ sourceId: "book", page: 12, title: "伪造来源" }] }, nodes[1]] });
  assert.equal(createConversationGraphTools().execute(spoof, evidence).ok, false);
});

test("research builds a requested conversation graph without global maintenance or book citations", async () => {
  const question = "用知识图谱整理刚才对话的整体逻辑";
  assert.equal(wantsObjects({ question, mode: "project" }), false);
  let calls = 0;
  const result = await research({
    question, mode: "project", chunks: [],
    history: [{ role: "user", content: "二分查找为什么要求有序？" }, { role: "assistant", content: "有序保证比较后能够排除一侧。" }],
  }, {
    complete: async (messages, json) => {
      calls++;
      if (json) {
        const context = JSON.parse(messages.at(-1).content);
        assert.equal(context.objectMaintenanceAllowed, false);
        assert.ok(context.availableTools.some((tool) => tool.name === "create_conversation_graph"));
        assert.ok(context.history.some((item) => item.content.includes("有序保证")));
        return JSON.stringify({ finish: true, actions: [action()] });
      }
      const instructions = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      assert.match(instructions, /基于当前对话整理的独立快照/);
      assert.match(instructions, /不会更新项目或章节图谱/);
      return "刚才讨论的逻辑已整理为图谱卡片。";
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.conversationGraphs.length, 1);
  assert.equal(result.proposal, undefined);
  assert.equal(result.research.mode, "qa");
  assert.deepEqual(result.evidence, []);
  assert.equal(result.research.trace.some((step) => step.tool === "maintain_graph"), false);
});

test("graph validation feedback is available to a corrective planning round", async () => {
  let round = 0;
  const result = await research({ question: "画出刚才对话的概念图", chunks: [] }, {
    complete: async (messages, json) => {
      if (!json) return "已整理图谱。";
      round++;
      if (round === 1) return JSON.stringify({ finish: true, actions: [action({ nodes: [{ ...action().nodes[0], links: ["missing"] }] })] });
      const context = JSON.parse(messages.at(-1).content);
      const failure = context.toolResults.find((item) => item.tool === "create_conversation_graph" && item.ok === false);
      assert.equal(failure.error.issues[0].path, "nodes[0].links[0]");
      return JSON.stringify({ finish: true, actions: [action()] });
    },
  });
  assert.equal(round, 2);
  assert.equal(result.conversationGraphs.length, 1);
  assert.equal(result.research.stopReason, "sufficient");
});

test("a planner-created local card never triggers a second project-wide graph mutation", async () => {
  let calls = 0;
  const result = await research({ question: "帮我整理知识图谱", mode: "project", chunks: evidence }, {
    complete: async (_messages, json) => {
      calls++;
      if (calls === 1) return JSON.stringify({ finish: true, actions: [action()] });
      assert.equal(json, false, "synthesis must not request maintain_graph output for a local card");
      return "已准备对话图谱。";
    },
  });
  assert.equal(result.conversationGraphs.length, 1);
  assert.equal(result.proposal, undefined);
});

test("ordinary answers and disconnected models do not fabricate graph artifacts", async () => {
  assert.deepEqual((await research({ question: "画图谱", chunks: [] }, {})).conversationGraphs, []);
  const result = await research({ question: "不要画图谱，只解释", chunks: [] }, {
    complete: async (_messages, json) => json ? '{"finish":true,"actions":[]}' : "解释。",
  });
  assert.deepEqual(result.conversationGraphs, []);
});
