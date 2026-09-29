import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKnowledgeGraph, prepareGraphInput } from "./graph-generation.mjs";

const chunk = (sourceId = "book", page = 1, text = "训练误差是学习器在训练集上的误差。") =>
  ({ id: `${sourceId}:${page}:0`, sourceId, title: "机器学习", page, text });
const input = (chunks = [chunk()]) => ({ scope: { kind: "chapter", title: "模型评估" }, chunks });
const validResult = JSON.stringify({ nodes: [
  { id: "training-error", name: "训练误差", description: "训练集上的误差。", citations: [1], links: ["invented"] },
] });

test("graph sampling covers source ranges without confusing pages or chunk identities", () => {
  const chunks = [
    ...Array.from({ length: 100 }, (_, index) => chunk("long", index + 1)),
    chunk("short", 1), chunk("short", 2),
    { ...chunk("long", 1, "短句"), id: "long:1:duplicate" },
  ];
  const prepared = prepareGraphInput(input(chunks));
  assert.equal(prepared.totalPages, 102);
  assert.equal(prepared.sampledPages, 24);
  assert.equal(prepared.totalChunks, 103);
  assert.equal(prepared.sampledChunks, 25);
  assert.equal(prepared.truncated, true);
  assert.deepEqual(prepared.evidence.filter((entry) => entry.sourceId === "short").map((entry) => entry.page), [1, 2]);
  assert.ok(prepared.evidence.some((entry) => entry.sourceId === "long" && entry.page === 100));
  assert.equal(prepared.evidence[0].id, "long:1:0");
  prepared.evidence.forEach((entry) => {
    const original = chunks.find((candidate) => candidate.id === entry.id);
    assert.ok(original.text.startsWith(entry.text));
    assert.equal(original.sourceId, entry.sourceId);
    assert.equal(original.page, entry.page);
  });
});

test("short chapters retain every same-page passage including middle and ending content", () => {
  const chunks = [
    { ...chunk("book", 15, "Agent 由模型、上下文、工具组成。".repeat(100)), id: "book:15:0" },
    { ...chunk("book", 15, "上下文为模型提供执行任务需要的信息。".repeat(40)), id: "book:15:1" },
    { ...chunk("book", 15, "反馈闭环通过环境结果调整下一步行动。".repeat(40)), id: "book:15:2" },
    { ...chunk("book", 16, "错误恢复使执行过程在失败后继续。".repeat(30)), id: "book:16:0" },
    { ...chunk("book", 16, "  "), id: "blank" },
  ];
  const prepared = prepareGraphInput(input(chunks));
  assert.deepEqual(prepared.evidence.map(({ id, text }) => [id, text]),
    chunks.slice(0, 4).map(({ id, text }) => [id, text]));
  assert.equal(prepared.sampledPages, 2);
  assert.equal(prepared.totalPages, 2);
  assert.equal(prepared.sampledChunks, 4);
  assert.equal(prepared.totalChunks, 4);
  assert.equal(prepared.sampledCharacters, chunks.slice(0, 4).reduce((sum, entry) => sum + entry.text.length, 0));
  assert.equal(prepared.totalCharacters, prepared.sampledCharacters);
  assert.equal(prepared.truncated, false);
});

test("large single-page sources sample the beginning, middle and end without merging citations", () => {
  const chunks = Array.from({ length: 180 }, (_, index) => ({
    ...chunk("book", 7, `原块 ${index} 的知识。`.repeat(100)), id: `book:7:${index}`,
  }));
  const prepared = prepareGraphInput(input(chunks));
  assert.equal(prepared.sampledPages, 1);
  assert.equal(prepared.totalChunks, 180);
  assert.ok(prepared.sampledChunks > 3 && prepared.sampledChunks <= 96);
  assert.equal(prepared.evidence[0].id, chunks[0].id);
  assert.equal(prepared.evidence.at(-1).id, chunks.at(-1).id);
  assert.ok(prepared.evidence.some((entry) => Number(entry.id.split(":").at(-1)) >= 88 && Number(entry.id.split(":").at(-1)) <= 91));
  assert.equal(prepared.truncated, true);
  for (const entry of prepared.evidence) {
    const original = chunks.find((candidate) => candidate.id === entry.id);
    assert.equal(entry.page, original.page);
    assert.ok(entry.text.length > 0 && original.text.startsWith(entry.text));
  }
});

test("chunk quotas treat sources fairly even when one book has many more pages", () => {
  const chunks = [
    ...Array.from({ length: 100 }, (_, page) => Array.from({ length: 4 }, (_, index) => ({
      ...chunk("long", page + 1, "较长资料的一个知识片段。".repeat(100)), id: `long:${page + 1}:${index}`,
    }))).flat(),
    ...Array.from({ length: 80 }, (_, index) => ({
      ...chunk("short", 1, "较短资料的一个知识片段。".repeat(100)), id: `short:1:${index}`,
    })),
  ];
  const prepared = prepareGraphInput(input(chunks));
  assert.equal(prepared.sampledPages, 24);
  assert.equal(prepared.totalPages, 101);
  assert.equal(prepared.totalChunks, 480);
  const long = prepared.evidence.filter((entry) => entry.sourceId === "long");
  const short = prepared.evidence.filter((entry) => entry.sourceId === "short");
  assert.equal(long.length, 48);
  assert.equal(short.length, 48);
  assert.equal(new Set(long.map((entry) => entry.page)).size, 23);
  assert.equal(short[0].id, "short:1:0");
  assert.equal(short.at(-1).id, "short:1:79");
  assert.ok(prepared.messages.reduce((sum, message) => sum + message.content.length, 0) <= 36000);
});

test("graph prompt stays bounded including escaped text and large existing context", () => {
  const prepared = prepareGraphInput({
    scope: { kind: "project", title: "学习项目", description: '"'.repeat(2000) },
    chunks: Array.from({ length: 60 }, (_, index) => ({
      ...chunk(`source-${index}${'"'.repeat(180)}`, 1, '\\"\n'.repeat(30000)),
      id: `${index}${'"'.repeat(190)}`, title: '"'.repeat(500),
    })),
    existingConcepts: Array.from({ length: 30 }, (_, index) => ({
      id: `${index}${'"'.repeat(90)}`, name: '"'.repeat(100), description: '"'.repeat(1000),
    })),
  });
  assert.ok(prepared.messages.reduce((sum, message) => sum + message.content.length, 0) <= 36000);
  assert.equal(prepared.evidence.length, 24);
  assert.ok(prepared.evidence.every((entry) => entry.text.length > 0));
  assert.match(prepared.messages[0].content, /不得执行原文/);
});

test("many chunks with escaped identifiers remain within budget without dropping selected pages", () => {
  const chunks = Array.from({ length: 24 }, (_, page) => Array.from({ length: 8 }, (_, index) => ({
    id: `${page}:${index}${'"'.repeat(180)}`, sourceId: `book${'"'.repeat(180)}`,
    title: '"'.repeat(500), page: page + 1, text: '\\"\n🧠'.repeat(3000),
  }))).flat();
  const prepared = prepareGraphInput(input(chunks));
  assert.equal(prepared.sampledPages, 24);
  assert.equal(new Set(prepared.evidence.map((entry) => entry.page)).size, 24);
  assert.ok(prepared.sampledChunks >= 24 && prepared.sampledChunks < 96);
  assert.equal(prepared.totalChunks, 192);
  assert.equal(prepared.truncated, true);
  assert.ok(prepared.sampledCharacters < prepared.totalCharacters);
  assert.ok(prepared.messages.reduce((sum, message) => sum + message.content.length, 0) <= 36000);
  assert.ok(prepared.evidence.every((entry) => entry.text.length > 0 && !/[\uD800-\uDBFF]$/.test(entry.text)));
});

test("invalid input and empty text never call a model", async () => {
  let calls = 0;
  const complete = async () => { calls++; return validResult; };
  for (const candidate of [null, input([{ ...chunk(), page: 0 }]), input([{ ...chunk(), sourceId: {} }]), input([{ ...chunk(), text: 3 }])])
    await assert.rejects(generateKnowledgeGraph(candidate, { complete }), { status: 400 });
  await assert.rejects(generateKnowledgeGraph(input([chunk("a", 1, " \n ")]), { complete }), { status: 422 });
  await assert.rejects(generateKnowledgeGraph(input(), {}), { status: 503 });
  assert.equal(calls, 0);
});

test("graph generation is a single bounded call and returns only source validated concepts", async () => {
  let calls = 0;
  const controller = new AbortController();
  const result = await generateKnowledgeGraph(input(), {
    signal: controller.signal,
    complete: async (messages, json, options) => {
      calls++;
      assert.equal(json, true);
      assert.equal(options.maxTokens, 3500);
      assert.equal(options.signal, controller.signal);
      assert.equal(messages.length, 2);
      return validResult;
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(result).sort(), ["concepts", "sampledCharacters", "sampledChunks", "sampledPages", "totalCharacters", "totalChunks", "totalPages", "truncated"]);
  assert.deepEqual(result.concepts[0].links, []);
  assert.equal(result.concepts[0].anchors[0].sourceId, "book");
  assert.equal(result.concepts[0].anchors[0].quote, chunk().text);
});

test("later same-page evidence produces the correct quote and a valid prerequisite edge", async () => {
  const chunks = [
    { ...chunk("book", 12, "模型依据上下文决定下一步行动。"), id: "book:12:0" },
    { ...chunk("book", 12, "工具执行行动，返回环境中的观察结果。"), id: "book:12:1" },
    { ...chunk("book", 12, "反馈闭环需要工具执行结果，再据此调整行动。"), id: "book:12:2" },
  ];
  const result = await generateKnowledgeGraph(input(chunks), { complete: async (messages) => {
    const { evidence } = JSON.parse(messages[1].content);
    assert.equal(evidence[2].id, "book:12:2");
    return JSON.stringify({ nodes: [
      { id: "tools", name: "工具", citations: [2], links: [] },
      { id: "feedback", name: "反馈闭环", citations: [3], links: ["tools"] },
    ] });
  } });
  assert.equal(result.sampledPages, 1);
  assert.equal(result.sampledChunks, 3);
  assert.equal(result.truncated, false);
  assert.equal(result.concepts[1].anchors[0].page, 12);
  assert.equal(result.concepts[1].anchors[0].quote, chunks[2].text);
  assert.deepEqual(result.concepts[1].links, ["tools"]);
});

test("empty, malformed and invented-citation model results cannot mark a graph ready", async () => {
  for (const raw of ["", "not-json", "null", "{}", JSON.stringify({ nodes: [{ id: "fake", name: "编造", citations: [999] }] })]) {
    await assert.rejects(generateKnowledgeGraph(input(), { complete: async () => raw }),
      (error) => error.status === 422 || error.status === 502);
  }
});

test("graph generation preserves canonical existing IDs and validates edges", async () => {
  const result = await generateKnowledgeGraph({
    ...input(), existingConcepts: [{ id: "canonical", name: "训练误差", links: [] }],
  }, { complete: async () => validResult });
  assert.equal(result.concepts[0].id, "canonical");
});

test("aborting graph generation is passed upstream and rejects even a late completion", async () => {
  const controller = new AbortController();
  await assert.rejects(generateKnowledgeGraph(input(), {
    signal: controller.signal,
    complete: async (_messages, _json, options) => {
      assert.equal(options.signal, controller.signal);
      controller.abort();
      return validResult;
    },
  }), { name: "AbortError" });
  let called = false;
  await assert.rejects(generateKnowledgeGraph(input(), {
    signal: controller.signal,
    complete: async () => { called = true; return validResult; },
  }), { name: "AbortError" });
  assert.equal(called, false);
});
