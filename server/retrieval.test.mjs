import { test } from "node:test";
import assert from "node:assert/strict";
import { retrieve, tokenize } from "./retrieval.mjs";
const chunks = [
  {
    id: "1",
    sourceId: "a",
    page: 1,
    title: "检索",
    text: "向量检索使用嵌入模型，将问题转换为向量。",
  },
  {
    id: "2",
    sourceId: "a",
    page: 2,
    title: "工具",
    text: "An agent selects tools and observes the results.",
  },
  {
    id: "3",
    sourceId: "b",
    page: 1,
    title: "Search",
    text: "Reciprocal rank fusion combines search rankings.",
  },
];
test("Chinese terms retrieve the appropriate evidence", () =>
  assert.equal(retrieve(chunks, "向量检索")[0].id, "1"));
test("English terms are case insensitive", () =>
  assert.equal(retrieve(chunks, "FUSION")[0].id, "3"));
test("Current reading page supplies context for deictic questions", () =>
  assert.equal(
    retrieve(chunks, "explain this", { sourceId: "a", page: 2 })[0].id,
    "2",
  ));
test("Empty and unmatched queries do not invent evidence", () => {
  assert.deepEqual(retrieve([], "test"), []);
  assert.deepEqual(retrieve(chunks, "zzzzzz"), []);
});
test("Query expansion can retrieve different-language evidence without duplicates", () => {
  const found = retrieve(chunks, "排序融合", null, [
    "rank fusion",
    "search rankings",
  ]);
  assert.equal(found[0].id, "3");
  assert.equal(new Set(found.map((c) => c.id)).size, found.length);
});
test("Chinese tokenization includes bigrams", () =>
  assert.ok(tokenize("知识图谱").includes("图谱")));
