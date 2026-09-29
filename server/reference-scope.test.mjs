import test from "node:test";
import assert from "node:assert/strict";
import { referenceScope, filterScopeReferences } from "../src/reference-scope.mjs";
import { resolveConceptDrop } from "../src/tutor-sessions.mjs";
import { resolveQuestionDrop } from "../src/question-references.mjs";

const concept = (id) => ({ id, name: id, description: "说明", anchors: [], links: [] });
const question = (id) => ({ id, kind: "question", title: id, question: { type: "choice", prompt: "选择？", options: ["甲", "乙"], answer: "0" } });
function fixture() {
  const p = {
    id: "p", sources: [{ id: "pdf", kind: "pdf", pages: Array(20).fill("正文"), progress: 15 }],
    concepts: [concept("a"), concept("b"), concept("shared")], sets: [], papers: [],
    chats: [{ id: "tutor" }, { id: "chat-a", context: { scopeNodeId: "chapter-a" } }, { id: "chat-project", context: { scopeNodeId: "tutor" } }],
    paperTree: { rootId: "project:p", tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: "project:p" },
      { id: "book:pdf", kind: "book", role: "source", sourceId: "pdf", parentId: "project:p" },
      ...["a", "b"].map((id, index) => ({ id: `chapter-${id}`, kind: "book", role: "chapter", sourceId: "pdf", parentId: "book:pdf", anchor: { sourceId: "pdf", page: index * 10 + 1 }, endPage: index * 10 + 10 })),
      { id: "graph", kind: "graph", parentId: "tutor" },
      { id: "graph-a", kind: "graph", role: "scope-graph", parentId: "chapter-a", conceptIds: ["a", "shared"] },
      { id: "graph-b", kind: "graph", role: "scope-graph", parentId: "chapter-b", conceptIds: ["b", "shared"] },
      { id: "chat-a", kind: "chat", parentId: "chapter-b", conversationRoot: true },
      { id: "chat-project", kind: "chat", parentId: "chapter-a", conversationRoot: true },
      { id: "local-a", kind: "graph", role: "history", parentId: "chat-a", graphConcepts: [concept("local-a-node")] },
      { id: "local-project", kind: "graph", role: "history", parentId: "chat-project", graphConcepts: [concept("local-project-node")] },
    ] },
  };
  const entries = [
    { id: "q-a", scopeId: "chapter-a", object: question("q-a") },
    { id: "q-b", scopeId: "chapter-b", object: question("q-b") },
    { id: "q-project", scopeId: "project", object: question("q-project") },
  ];
  return { p, entries };
}

test("chapter references come from its graphs and practice, not its neighbour or mutable reading page", () => {
  const { p, entries } = fixture(), before = structuredClone(p);
  assert.deepEqual(referenceScope(p, "chapter-a", entries), {
    scopeId: "chapter-a", conceptIds: ["a", "shared", "local-a-node"], questionIds: ["q-a"],
  });
  assert.deepEqual(referenceScope(p, "chapter-b", entries), {
    scopeId: "chapter-b", conceptIds: ["b", "shared"], questionIds: ["q-b"],
  });
  assert.deepEqual(p, before);
  p.sources[0].progress = 2;
  assert.deepEqual(referenceScope(p, "chapter-a", entries).conceptIds, ["a", "shared", "local-a-node"]);
});

test("project graphs share canonical concepts but do not absorb chapter-local conversation objects", () => {
  const { p, entries } = fixture();
  for (const id of ["tutor", "book:pdf", "project:p", undefined]) {
    assert.deepEqual(referenceScope(p, id, entries), {
      scopeId: "project", conceptIds: ["a", "b", "shared", "local-project-node"], questionIds: ["q-project"],
    });
  }
});

test("an explicit empty chapter graph has no canonical references and missing concepts cannot be revived by IDs", () => {
  const { p, entries } = fixture();
  const graph = p.paperTree.nodes.find((node) => node.id === "graph-b");
  graph.conceptIds = [];
  assert.deepEqual(referenceScope(p, "chapter-b", entries).conceptIds, []);
  graph.conceptIds = ["deleted"];
  assert.deepEqual(filterScopeReferences(p.concepts, referenceScope(p, "chapter-b", entries).conceptIds), []);
});

test("scope checks filter stale drafts and never trust project or scope fields supplied by drag data", () => {
  const { p, entries } = fixture();
  const scope = referenceScope(p, "chapter-a", entries);
  const concepts = filterScopeReferences(p.concepts, scope.conceptIds);
  const questions = filterScopeReferences(entries.map((entry) => entry.object), scope.questionIds);
  const conceptPayload = { version: 1, kind: "concept", projectId: "p", conceptId: "b", scopeId: "chapter-a" };
  assert.equal(resolveConceptDrop(conceptPayload, p.id, concepts), null);
  assert.equal(resolveConceptDrop({ ...conceptPayload, conceptId: "a" }, p.id, concepts).id, "a");
  assert.equal(resolveConceptDrop({ ...conceptPayload, conceptId: "a", projectId: "other" }, p.id, concepts), null);
  const questionPayload = { version: 1, kind: "question", projectId: "p", questionId: "q-b", scopeId: "chapter-a" };
  assert.equal(resolveQuestionDrop(questionPayload, p.id, questions), null);
  assert.equal(resolveQuestionDrop({ ...questionPayload, questionId: "q-a" }, p.id, questions).id, "q-a");
  assert.equal(resolveQuestionDrop({ ...questionPayload, questionId: "q-a", projectId: "other" }, p.id, questions), null);
});
