import test from "node:test";
import assert from "node:assert/strict";
import { projectReadingRoot, scopeAttachments } from "../src/reading-scope-navigation.mjs";
import { conversationNodes, projectNavigationId, projectNavigationNodes } from "../src/conversation-model.mjs";

function fixture() {
  return {
    id: "project", name: "机器学习", sources: [{ id: "book", kind: "pdf", pages: Array(12).fill("正文") }],
    chats: [{ id: "tutor" }, { id: "main", context: { parentId: "chapter", scopeNodeId: "chapter" } }],
    sets: [
      { id: "inline", title: "概念检测", presentation: "inline", scopeNodeId: "chapter", questions: [{ id: "q1" }] },
      { id: "project-set", title: "综合练习", scopeNodeId: "tutor", questions: [{ id: "q2" }, { id: "q3" }] },
      { id: "empty", title: "未填写", questions: [] },
    ], papers: [],
    paperTree: { rootId: "project:project", tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: "project:project" },
      { id: "book:book", kind: "book", role: "source", sourceId: "book", parentId: "project:project" },
      { id: "chapter", kind: "book", role: "chapter", sourceId: "book", parentId: "book:book", anchor: { sourceId: "book", page: 1 }, endPage: 12 },
      { id: "main", kind: "chat", parentId: "chapter" },
      { id: "graph", kind: "graph", parentId: "tutor" },
      { id: "questions:inline", kind: "questions", objectId: "inline", parentId: "main" },
      { id: "questions:project-set", kind: "questions", objectId: "project-set", parentId: "tutor" },
    ] },
  };
}

test("the project keeps its PDF identity and places independent chats inside its reading entrance", () => {
  const project = fixture(), before = structuredClone(project);
  assert.equal(projectReadingRoot(project).id, "book:book");
  assert.equal(projectNavigationNodes(project).find((node) => node.id === "tutor").parentId, "book:book");
  assert.equal(projectNavigationNodes(project).find((node) => node.id === "main").parentId, "chapter");
  assert.deepEqual(project, before);
  project.sources = [];
  assert.equal(projectReadingRoot(project).id, "tutor");
});

test("chapter cards include a pending graph and small inline practice without adding navigation nodes", () => {
  const project = fixture(), before = structuredClone(project);
  const cards = scopeAttachments(project, "chapter");
  assert.equal(cards.graphMissing, true);
  assert.equal(cards.graph.id, "scope-graph:chapter");
  assert.equal(cards.graph.parentId, "chapter");
  assert.deepEqual(cards.questions.map(({ node, title, count }) => [node.id, title, count]), [["questions:inline", "概念检测", 1]]);
  assert.equal(projectNavigationNodes(project).some((node) => node.kind === "questions" || node.kind === "graph"), false);
  assert.deepEqual(project, before);
});

test("project aliases share one archive; saved graphs retain their identity", () => {
  const project = fixture();
  project.paperTree.nodes.push({ id: "existing-graph", kind: "graph", role: "scope-graph", parentId: "chapter" });
  assert.equal(scopeAttachments(project, "chapter").graph.id, "existing-graph");
  assert.equal(scopeAttachments(project, "chapter").graphMissing, false);
  for (const id of ["project:project", "book:book", "tutor"]) {
    const cards = scopeAttachments(project, id);
    assert.equal(cards.graph.id, "graph");
    assert.deepEqual(cards.questions.map((card) => [card.node.id, card.count]), [["questions:project-set", 2]]);
  }
});

test("legacy question cards remain accessible but saved tool questions appear only once", () => {
  const project = fixture();
  project.papers.push(
    { id: "old", object: { id: "legacy-q", kind: "question", title: "旧检测" } },
    { id: "duplicate", object: { id: "question:inline:q1", kind: "question", title: "重复快照" } },
  );
  project.paperTree.nodes.push(
    { id: "paper:old", kind: "paper", objectId: "old", parentId: "main" },
    { id: "paper:duplicate", kind: "paper", objectId: "duplicate", parentId: "main" },
  );
  assert.deepEqual(scopeAttachments(project, "chapter").questions.map((card) => card.title), ["概念检测", "旧检测"]);
});

test("object-specific chats are local to their card while their sidebar selection reveals the chapter", () => {
  const project = fixture();
  project.chats.push({ id: "question-chat", context: { objectNodeId: "questions:inline", scopeNodeId: "chapter" } });
  project.paperTree.nodes.push(
    { id: "question-chat", kind: "chat", parentId: "questions:inline", conversationRoot: true },
    { id: "question-followup", kind: "chat", parentId: "question-chat" },
  );
  assert.equal(projectNavigationNodes(project).some((node) => node.id.startsWith("question-")), false);
  assert.equal(projectNavigationId(project, "question-chat"), "chapter");
  assert.equal(projectNavigationId(project, "question-followup"), "chapter");
  assert.deepEqual(conversationNodes(project, "question-chat").map((node) => node.id), ["question-chat", "question-followup"]);
});

test("a historical message-only quiz is archived with its original identity and scope", () => {
  const project = fixture();
  project.chats.find((chat) => chat.id === "main").messages = [{
    id: "answer", role: "assistant",
    content: "```sidereader-object\n" + JSON.stringify({ kind: "question", title: "二分检测", question: {
      id: "legacy", type: "choice", prompt: "下一步保留哪一侧？", options: ["左", "右"], answer: "1", explanation: "目标大于中点。",
    } }) + "\n```",
  }];
  const before = structuredClone(project);
  const cards = scopeAttachments(project, "chapter").questions;
  const card = cards.find((item) => item.title === "二分检测");
  assert.equal(card.node.id, "answer:object:0");
  assert.equal(card.count, 1);
  assert.equal(card.practiceEntry.originNodeId, "main");
  assert.equal(card.practiceEntry.sourceMessageId, "answer");
  assert.equal(scopeAttachments(project, "book:book").questions.some((item) => item.title === "二分检测"), false);
  assert.deepEqual(project, before, "indexing an old answer never creates a persisted file or changes its attempts");
});
