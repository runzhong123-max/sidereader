import test from "node:test";
import assert from "node:assert/strict";
import { indexById, traceChain, parentChain, hasDirectedPath, createRelationIndex, chapterRange, chapterForReading } from "../src/domain/relations.mjs";
import { conversationOwner, conversationRoot, projectNavigationNodes } from "../src/conversation-model.mjs";
import { knowledgeGraphOwner, readingDestination, learningObjectNodes } from "../src/paper-navigation.mjs";
import { paperAncestors } from "../src/paper-tree-state.mjs";
import { prerequisiteWouldCycle } from "../src/stage-state.mjs";

function fixture() {
  return {
    id: "project", sources: [{ id: "s", pages: Array(20).fill("text"), progress: 19 }],
    chats: [
      { id: "located", context: { sourceId: "s", reading: { sourceId: "s", page: 6 } } },
      { id: "fixed", context: { scopeNodeId: "chapter", reading: { sourceId: "s", page: 19 } } },
    ],
    sets: [{ id: "exercise", scopeNodeId: "section", questions: [{ id: "q" }], presentation: "collection" }],
    stages: [], concepts: [{ id: "a", links: ["b"] }, { id: "b", links: ["a"] }],
    paperTree: { version: 2, rootId: "project:project", tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: "project:project" },
      { id: "book:s", kind: "book", role: "source", sourceId: "s", parentId: "project:project" },
      { id: "chapter", kind: "book", role: "chapter", sourceId: "s", anchor: { sourceId: "s", page: 2 }, endPage: 10, parentId: "book:s" },
      { id: "section", kind: "book", role: "chapter", sourceId: "s", anchor: { sourceId: "s", page: 5 }, endPage: 7, parentId: "chapter" },
      { id: "graph:section", kind: "graph", role: "scope-graph", parentId: "section" },
      { id: "located", kind: "chat", parentId: "tutor", conversationRoot: true },
      { id: "fixed", kind: "chat", parentId: "section", conversationRoot: true },
      { id: "questions:exercise", kind: "questions", objectId: "exercise", parentId: "fixed" },
    ] },
  };
}

test("one-parent traversal reports the actual cycle without rewriting provenance", () => {
  const input = [
    { id: "leaf", parentId: "b" }, { id: "b", parentId: "a" }, { id: "a", parentId: "b" },
    { id: "b", parentId: "missing", title: "conflicting duplicate" },
  ];
  const before = structuredClone(input), nodes = indexById(input);
  const traced = traceChain(nodes.get("leaf"), (node) => nodes.get(node.parentId));
  assert.deepEqual(traced.nodes.map((node) => node.id), ["leaf", "b", "a"]);
  assert.equal(traced.cycleStart, 1);
  assert.equal(nodes.get("b"), input[1]);
  assert.deepEqual(parentChain(nodes, "missing"), []);
  assert.deepEqual(paperAncestors({ paperTree: { nodes: input } }, "leaf").map((node) => node.id), ["a", "b"]);
  const project = { paperTree: { nodes: input.map((node) => ({ ...node, kind: "chat" })) } };
  assert.equal(conversationRoot(project, "leaf").id, "a");
  assert.deepEqual(input, before);
});

test("directed prerequisite checks handle diamonds, missing nodes and unrelated existing cycles", () => {
  const stages = [
    { id: "end", prerequisites: ["left", "right"] },
    { id: "left", prerequisites: ["start"] }, { id: "right", prerequisites: ["start"] },
    { id: "start" }, { id: "bad-a", prerequisites: ["bad-b"] }, { id: "bad-b", prerequisites: ["bad-a", "deleted"] },
  ];
  const before = structuredClone(stages), nodes = indexById(stages);
  assert.equal(prerequisiteWouldCycle(stages, "start", "end"), true);
  assert.equal(prerequisiteWouldCycle(stages, "end", "start"), false);
  assert.equal(prerequisiteWouldCycle(stages, "end", "bad-a"), false);
  assert.equal(prerequisiteWouldCycle(stages, "end", "deleted"), false);
  assert.equal(prerequisiteWouldCycle(stages, "end", "end"), true);
  assert.equal(hasDirectedPath("bad-a", "bad-b", (id) => nodes.get(id)?.prerequisites), true);
  assert.deepEqual(stages, before);
});

test("reading, conversation and graph use one chapter policy while saved scope wins", () => {
  const project = fixture(), before = structuredClone(project), relations = createRelationIndex(project);
  assert.equal(chapterForReading(relations, { sourceId: "s", page: 6 }).id, "section");
  assert.equal(readingDestination(project, { sourceId: "s", page: 6 }).id, "section");
  assert.equal(readingDestination(project, { sourceId: "s", page: 6 }, "chapter").id, "chapter");
  for (const [id, owner] of [["located", "section"], ["fixed", "chapter"], ["questions:exercise", "section"]]) {
    assert.equal(conversationOwner(project, id).id, owner);
    assert.equal(knowledgeGraphOwner(project, id).id, owner);
  }
  assert.deepEqual(projectNavigationNodes(project).filter((node) => node.kind === "chat").map((node) => [node.id, node.parentId]), [
    ["tutor", "book:s"], ["located", "section"], ["fixed", "chapter"],
  ]);
  // Concept associations may cycle. Location projections must not treeify them.
  assert.deepEqual(project, before);
  project.chats.find((chat) => chat.id === "fixed").context.scopeNodeId = "deleted";
  assert.equal(conversationOwner(project, "fixed").id, "tutor");
  assert.equal(knowledgeGraphOwner(project, "fixed").id, "tutor");
});

test("invalid chapter ranges and duplicate identities resolve consistently across entry points", () => {
  const project = fixture();
  const original = project.paperTree.nodes.find((node) => node.id === "section");
  project.paperTree.nodes.push({ ...original, endPage: 19, parentId: "tutor" });
  assert.equal(readingDestination(project, { sourceId: "s", page: 12 }).id, "book:s");
  assert.equal(conversationOwner(project, "located").id, "section");
  original.anchor.sourceId = "other-source";
  const relations = createRelationIndex(project);
  assert.equal(chapterRange(relations, original), undefined);
  assert.equal(readingDestination(project, { sourceId: "s", page: 6 }).id, "chapter");
  assert.equal(conversationOwner(project, "located").id, "chapter");
  assert.equal(knowledgeGraphOwner(project, "questions:exercise").id, "tutor");
  assert.equal(learningObjectNodes(project).some((node) => node.id === "graph:section"), false);
  for (const page of [0, 21, 3.2, "6", NaN]) assert.equal(chapterForReading(relations, { sourceId: "s", page }), undefined);
});
