import test from "node:test";
import assert from "node:assert/strict";
import { graphProvenance, objectScopeLabel, questionOriginLabel } from "../src/object-provenance.mjs";

function fixture() {
  return {
    id: "p", name: "机器学习", sources: [{ id: "pdf", title: "机器学习", pages: ["一", "二", "三"] }],
    concepts: [], stages: [], sets: [], chats: [
      { id: "tutor", title: "项目对话", messages: [] },
      { id: "chat", title: "线性模型为什么可解释", context: { scopeNodeId: "chapter" }, messages: [{ id: "answer", role: "assistant", content: "解释" }] },
    ],
    paperTree: { tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: null },
      { id: "pdf-node", kind: "book", sourceId: "pdf", role: "source", parentId: null },
      { id: "chapter", kind: "book", sourceId: "pdf", role: "chapter", title: "第三章 线性模型", parentId: "pdf-node", anchor: { sourceId: "pdf", page: 1 }, endPage: 3 },
      { id: "chat", kind: "chat", parentId: "chapter" },
      { id: "local", kind: "graph", parentId: "chat", sourceMessageId: "answer", graphConcepts: [] },
      { id: "chapter-graph", kind: "graph", role: "scope-graph", parentId: "chapter" },
      { id: "graph", kind: "graph", parentId: "tutor" },
    ] },
  };
}

test("practice descriptions use explicit provenance without inventing authorship for legacy data", () => {
  assert.equal(questionOriginLabel({ origin: "textbook", presentation: "inline" }), "教材习题");
  assert.equal(questionOriginLabel({ origin: "generated", presentation: "inline" }), "随堂检测");
  assert.equal(questionOriginLabel({ origin: "generated", presentation: "collection" }), "生成练习");
  assert.equal(questionOriginLabel({ origin: "manual" }), "自编习题");
  assert.equal(questionOriginLabel({ presentation: "inline", questions: [{}], sourceMessageId: "answer" }), "习题");
});

test("local graph identity keeps conversation provenance and chapter ownership distinct", () => {
  const project = fixture(), before = structuredClone(project);
  const local = project.paperTree.nodes.find((node) => node.id === "local");
  assert.deepEqual(graphProvenance(project, local), {
    label: "本次对话图谱", scope: "第三章 线性模型",
    origin: project.paperTree.nodes.find((node) => node.id === "chat"), originTitle: "线性模型为什么可解释",
  });
  assert.equal(graphProvenance(project, project.paperTree.nodes.find((node) => node.id === "chapter-graph")).label, "本章知识图谱");
  assert.equal(graphProvenance(project, project.paperTree.nodes.find((node) => node.id === "graph")).label, "项目知识图谱");
  assert.equal(objectScopeLabel(project, "graph"), "机器学习");
  assert.deepEqual(project, before, "describing a view never rewrites ownership or persisted content");
});

test("missing or stale origin messages do not produce a dead conversation link", () => {
  const project = fixture(), local = project.paperTree.nodes.find((node) => node.id === "local");
  assert.equal(graphProvenance(project, { ...local, sourceMessageId: "deleted" }).origin, undefined);
  assert.equal(graphProvenance(project, { ...local, parentId: "deleted" }).origin, undefined);
  assert.equal(graphProvenance(project, { ...local, graphConcepts: undefined }).origin, undefined);
  assert.equal(graphProvenance(project, local).label, "本次对话图谱", "an emptied local graph is still a conversation graph");
});
