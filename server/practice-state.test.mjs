import test from "node:test";
import assert from "node:assert/strict";
import { persistMessagePractice } from "../src/practice-state.mjs";
import { questionObject } from "../src/question-state.mjs";

function fixture() {
  return {
    id: "p", sets: [], sources: [{ id: "s", pages: Array(12).fill("text"), progress: 12 }],
    chats: [{ id: "tutor", messages: [] }, { id: "chat", context: { scopeNodeId: "chapter" }, messages: [] }],
    stages: [{ id: "stage", done: false }], tabs: [{ id: "book", kind: "book", sourceId: "s" }], activeTab: "book",
    paperTree: { version: 2, rootId: "project:p", tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: "project:p" },
      { id: "book", kind: "book", role: "source", sourceId: "s", parentId: "project:p" },
      { id: "chapter", kind: "book", role: "chapter", sourceId: "s", anchor: { sourceId: "s", page: 1 }, endPage: 6, parentId: "book" },
      { id: "chat", kind: "chat", parentId: "tutor" },
    ] },
  };
}
const question = { id: "q", type: "choice", prompt: "区间是什么？", options: ["A", "B"], answer: "0", explanation: "原因", anchors: [{ sourceId: "s", page: 2, title: "教材习题" }] };
const set = { id: "generated", title: "教材练习", description: "抽取习题", questions: [question], origin: "textbook", presentation: "collection", anchors: [{ sourceId: "s", page: 2, title: "教材" }] };
const message = { id: "response", role: "assistant", questionSets: [set], readingContext: { sourceId: "s", page: 3, title: "原始位置" } };

test("tool question sets persist at their fixed conversation scope and preserve original source fields and ids", () => {
  const project = fixture();
  const before = structuredClone(project);
  const result = persistMessagePractice(project, "chat", message);
  const saved = result.sets[0];
  assert.equal(saved.id, set.id);
  assert.equal(saved.scopeNodeId, "chapter");
  assert.equal(saved.sourceMessageId, message.id);
  assert.equal(saved.origin, "textbook");
  assert.equal(saved.presentation, "collection");
  assert.deepEqual(saved.anchors, set.anchors);
  assert.deepEqual(saved.questions, set.questions);
  assert.equal(questionObject(saved.id, saved.questions[0]).id, "question:generated:q");
  const node = result.paperTree.nodes.find((item) => item.id === "questions:generated");
  assert.equal(node.parentId, "chat");
  assert.equal(node.objectId, saved.id);
  assert.equal(node.origin, "tool");
  assert.equal(node.sourceMessageId, message.id);
  assert.deepEqual(node.anchor, message.readingContext);
  assert.equal(result.tabs, project.tabs);
  assert.equal(result.activeTab, project.activeTab);
  assert.equal(result.stages, project.stages);
  assert.deepEqual(project, before);
});

test("repeated callbacks, duplicate tool results and existing edited sets never overwrite user work", () => {
  const project = fixture();
  const first = persistMessagePractice(project, "chat", { ...message, questionSets: [set, set] });
  assert.equal(first.sets.length, 1);
  assert.equal(first.paperTree.nodes.filter((node) => node.objectId === set.id).length, 1);
  first.sets[0] = { ...first.sets[0], title: "我的标题", questions: [{ ...question, prompt: "用户修订" }] };
  const repeated = persistMessagePractice(first, "tutor", message);
  assert.equal(repeated, first);
  assert.equal(repeated.sets[0].title, "我的标题");
  assert.equal(repeated.sets[0].scopeNodeId, "chapter");
  assert.equal(repeated.sets[0].questions[0].prompt, "用户修订");
});

test("invalid or uncompleted messages add nothing", () => {
  const project = fixture();
  for (const candidate of [
    { ...message, role: "user" }, { ...message, error: true }, { ...message, questionSets: undefined },
    { ...message, questionSets: [{ ...set, questions: [] }] },
    { ...message, questionSets: [{ ...set, questions: [{ ...question, prompt: " " }] }] },
    { ...message, questionSets: [{ ...set, questions: [question, question] }] },
  ]) assert.equal(persistMessagePractice(project, "chat", candidate), project);
});

test("saved origin remains fixed and current page never supplies a scope or anchor", () => {
  const project = fixture();
  const noReading = { ...message, readingContext: undefined };
  const result = persistMessagePractice(project, "tutor", noReading);
  assert.equal(result.sets[0].scopeNodeId, "tutor");
  assert.equal(result.paperTree.nodes.find((node) => node.objectId === set.id).anchor, undefined);
  const missing = persistMessagePractice(project, "missing", noReading);
  assert.equal(missing.sets[0].scopeNodeId, "tutor");
  assert.equal(missing.paperTree.nodes.find((node) => node.objectId === set.id).parentId, "tutor");
});

test("legacy projects can restore tool results without opening a new tab or marking a stage complete", () => {
  const project = fixture();
  delete project.paperTree;
  const result = persistMessagePractice(project, "tutor", message);
  assert.equal(result.sets.length, 1);
  assert.equal(result.tabs, project.tabs);
  assert.equal(result.activeTab, "book");
  assert.equal(result.stages[0].done, false);
  assert.equal(result.paperTree.nodes.find((node) => node.objectId === set.id).parentId, "tutor");
});

test("existing nodes and user placement are preserved when repairing a missing set", () => {
  const project = fixture();
  const node = { id: "questions:generated", kind: "questions", objectId: set.id, parentId: "tutor", origin: "manual" };
  project.paperTree.nodes.push(node);
  const result = persistMessagePractice(project, "chat", message);
  assert.equal(result.paperTree.nodes.filter((item) => item.objectId === set.id).length, 1);
  assert.equal(result.paperTree.nodes.find((item) => item.id === node.id), node);
});

test("extracted questions may explicitly lack a source answer without losing source metadata", () => {
  const project = fixture();
  const extracted = { ...set, questions: [{ ...question, answer: "", answerStatus: "missing", sourceQuestionNumber: "2.1" }] };
  const result = persistMessagePractice(project, "chat", { ...message, questionSets: [extracted] });
  assert.equal(result.sets.length, 1);
  assert.equal(result.sets[0].questions[0].answerStatus, "missing");
  assert.equal(result.sets[0].questions[0].sourceQuestionNumber, "2.1");
  assert.deepEqual(result.sets[0].questions[0].anchors, question.anchors);
});
