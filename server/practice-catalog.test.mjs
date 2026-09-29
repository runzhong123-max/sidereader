import test from "node:test";
import assert from "node:assert/strict";
import { practiceCatalog } from "../src/practice-catalog.mjs";
import { parseAnswer } from "../src/learning-objects.mjs";
import { questionObject, questionRevision, questionView } from "../src/question-state.mjs";

const question = {
  id: "q", type: "choice", prompt: "下一轮候选区间是什么？",
  options: ["[3,4]", "[0,1]"], answer: "0", explanation: "比较中点后保留右侧。",
};
const set = { id: "set", title: "二分练习", description: "", questions: [question] };
const asContent = (q = question) => "```sidereader-object\n" + JSON.stringify({ kind: "question", title: "区间小测", question: q }) + "\n```";
function fixture() {
  return {
    id: "p", sources: [{ id: "book", pages: Array(20).fill("text"), progress: 17 }],
    sets: [], papers: [], attempts: [], questionDrafts: {},
    chats: [{ id: "tutor", title: "项目 tutor", messages: [] }, { id: "chapter-chat", title: "第一章对话", messages: [] }],
    paperTree: { rootId: "root", tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: "root" },
      { id: "book", kind: "book", role: "source", sourceId: "book", parentId: "root" },
      { id: "chapter:1", kind: "book", role: "chapter", title: "第一章", sourceId: "book", anchor: { sourceId: "book", page: 1 }, endPage: 10, parentId: "book" },
      { id: "chapter:2", kind: "book", role: "chapter", title: "第二章", sourceId: "book", anchor: { sourceId: "book", page: 11 }, endPage: 20, parentId: "book" },
      { id: "chapter-chat", kind: "chat", parentId: "chapter:1" },
      { id: "questions", kind: "questions", objectId: "set", parentId: "chapter-chat" },
    ] },
  };
}
function attempt(object, result = "correct", more = {}) {
  return {
    id: "a", objectId: object.id, questionRevision: questionRevision(object.question),
    prompt: object.question.prompt, answer: "[3,4]", answerValue: "0", result,
    assisted: false, at: "2026-09-24", feedback: "", ...more,
  };
}

test("message-only questions are indexed without creating papers and non-question fragments are excluded", () => {
  const project = fixture();
  project.chats[0].messages = [
    { id: "user", role: "user", content: asContent() },
    { id: "failed", role: "assistant", error: true, content: asContent() },
    { id: "m", role: "assistant", content: "```python\nprint(1)\n```\n" + asContent(), evidence: [{ id: "e" }] },
    { id: "bad", role: "assistant", content: "```sidereader-object\n{broken}\n```" },
  ];
  const before = structuredClone(project);
  const [entry] = practiceCatalog(project);
  assert.equal(practiceCatalog(project).length, 1);
  assert.equal(entry.id, "m:object:1");
  assert.equal(entry.object.id, entry.id);
  assert.equal(entry.sourceMessageId, "m");
  assert.equal(entry.originNodeId, "tutor");
  assert.equal(entry.scopeId, "project");
  assert.deepEqual(entry.evidence, [{ id: "e" }]);
  assert.deepEqual(project, before);
});

test("an opened paper and its original assistant message count once by stable object id", () => {
  const project = fixture();
  const message = { id: "m", role: "assistant", content: asContent(), evidence: [{ id: "e" }] };
  const object = parseAnswer(message.content, message.id)[0].object;
  project.chats[1].messages = [message];
  project.papers = [{ id: "paper", parentId: "chapter-chat", parentTitle: "第一章对话", object, evidence: [], sourceMessageId: "m" }];
  const [entry] = practiceCatalog(project);
  assert.equal(practiceCatalog(project).length, 1);
  assert.equal(entry.originNodeId, "chapter-chat");
  assert.equal(entry.scopeId, "chapter:1");
  assert.deepEqual(entry.evidence, message.evidence);
  assert.equal(entry.sourceMessageId, "m");
});

test("current set questions override stale paper snapshots and invalidate old scores after edits", () => {
  const project = fixture();
  const oldObject = questionObject(set.id, question);
  project.papers = [{ id: "paper", parentId: "questions", object: oldObject, evidence: [{ id: "e" }] }];
  project.sets = [{ ...set, questions: [{ ...question, prompt: "修改后的题干", answer: "1" }] }];
  project.attempts = [attempt(oldObject)];
  const [entry] = practiceCatalog(project);
  assert.equal(practiceCatalog(project).length, 1);
  assert.equal(entry.object.question.prompt, "修改后的题干");
  assert.equal(entry.object.question.answer, "1");
  assert.equal(entry.id, oldObject.id);
  assert.equal(entry.setId, set.id);
  assert.equal(entry.originTitle, set.title);
  assert.equal(entry.originNodeId, "questions");
  assert.equal(entry.status, "unanswered");
  assert.deepEqual(entry.evidence, [{ id: "e" }]);
  assert.equal(project.attempts.length, 1);
});

test("empty or incomplete draft questions cannot resurrect an older saved question", () => {
  const project = fixture();
  project.papers = [{ id: "paper", parentId: "questions", object: questionObject(set.id, question) }];
  for (const patch of [{ prompt: " " }, { answer: "" }, { answer: "3" }, { options: ["A", ""] }]) {
    project.sets = [{ ...set, questions: [{ ...question, ...patch }] }];
    assert.deepEqual(practiceCatalog(project), []);
  }
});

test("deleting a set preserves already-saved snapshots with their attempt identity", () => {
  const project = fixture();
  const object = questionObject(set.id, question);
  project.papers = [{ id: "paper", parentId: "questions", object, parentTitle: "二分练习" }];
  project.attempts = [attempt(object)];
  const [entry] = practiceCatalog(project);
  assert.equal(entry.id, object.id);
  assert.equal(entry.setId, undefined);
  assert.equal(entry.object, object);
  assert.equal(entry.status, "answered");
});

test("retry and revision-aware drafts use the same questionView as original practice surfaces", () => {
  const project = fixture();
  project.sets = [set];
  const object = questionObject(set.id, question);
  project.attempts = [attempt(object)];
  project.questionDrafts = { [object.id]: { revision: questionRevision(question), answer: "1", retry: true } };
  const [entry] = practiceCatalog(project);
  assert.equal(entry.status, "unanswered");
  assert.equal(entry.statusLabel, "待重做");
  assert.equal(questionView(entry.id, entry.object.question, project.attempts, project.questionDrafts).answer, "1");
  assert.equal(questionView(entry.id, entry.object.question, project.attempts, project.questionDrafts).result, undefined);
  project.questionDrafts[object.id].revision = "outdated";
  assert.equal(practiceCatalog(project)[0].status, "answered");
});

test("errors, assisted answers, and pending self assessment stay reviewable without claiming mastery", () => {
  const project = fixture();
  project.sets = [set];
  const object = questionObject(set.id, question);
  for (const [result, assisted, status, label] of [
    ["correct", false, "answered", "回答正确"],
    ["correct", true, "review", "参考提示或解析后答对"],
    ["incorrect", false, "review", "回答有误"],
    ["needs-review", false, "review", "待自评"],
    ["self-incorrect", false, "review", "自评：需要补充"],
    ["self-correct", false, "answered", "自评：基本正确"],
    ["self-correct", true, "review", "参考解析后自评：基本正确"],
    ["skipped", false, "unanswered", "已跳过"],
  ]) {
    project.attempts = [attempt(object, result, { assisted })];
    const [entry] = practiceCatalog(project);
    assert.equal(entry.status, status);
    assert.equal(entry.statusLabel, label);
    assert.ok(!entry.statusLabel.includes("掌握"));
  }
  project.attempts = [attempt(object, "hint-viewed")];
  assert.equal(practiceCatalog(project)[0].status, "unanswered");
});

test("fixed conversation chapter wins over ancestry, message page, and current reader progress", () => {
  const project = fixture();
  const chat = project.chats[1];
  chat.context = { scopeNodeId: "chapter:2", sourceId: "book" };
  chat.messages = [{ id: "m", role: "assistant", content: asContent(), readingContext: { sourceId: "book", page: 3 } }];
  assert.equal(practiceCatalog(project)[0].scopeId, "chapter:2");
  chat.context.scopeNodeId = "deleted-chapter";
  assert.equal(practiceCatalog(project)[0].scopeId, "project");
});

test("generated or textbook sets use explicit saved scope and generation provenance", () => {
  const project = fixture();
  for (const origin of ["generated", "textbook", "manual"]) {
    project.sets = [{ ...set, origin, scopeNodeId: "chapter:2", sourceMessageId: "generation" }];
    const [entry] = practiceCatalog(project);
    assert.equal(entry.scopeId, "chapter:2");
    assert.equal(entry.sourceMessageId, "generation");
    assert.equal(entry.setId, set.id);
    project.sets[0].scopeNodeId = "removed";
    assert.equal(practiceCatalog(project)[0].scopeId, "project");
    project.sets[0].scopeNodeId = "tutor";
    assert.equal(practiceCatalog(project)[0].scopeId, "project");
  }
  project.paperTree.nodes = project.paperTree.nodes.filter((node) => node.id !== "questions");
  project.papers = [{ id: "paper", parentId: "chapter-chat", object: questionObject(set.id, question) }];
  assert.equal(practiceCatalog(project)[0].scopeId, "project", "snapshot provenance must not overwrite an explicit project scope");
});

test("inline tools return to their original conversation while collections open their saved question set", () => {
  const project = fixture();
  project.sets = [{ ...set, presentation: "inline", sourceMessageId: "m" }];
  let entry = practiceCatalog(project)[0];
  assert.equal(entry.originNodeId, "chapter-chat");
  assert.equal(entry.originTitle, "第一章对话");
  assert.equal(entry.sourceMessageId, "m");
  project.sets[0].presentation = "collection";
  assert.equal(practiceCatalog(project)[0].originNodeId, "questions");
  project.sets[0].presentation = "inline";
  project.paperTree.nodes.find((node) => node.id === "questions").parentId = "missing";
  assert.equal(practiceCatalog(project)[0].originNodeId, undefined);
});

test("textbook questions without answer keys are available and explicitly await checking", () => {
  const project = fixture();
  const missing = { ...question, answer: "", answerStatus: "missing" };
  project.sets = [{ ...set, origin: "textbook", questions: [missing] }];
  assert.equal(practiceCatalog(project)[0].status, "unanswered");
  project.attempts = [attempt(questionObject(set.id, missing), "needs-review")];
  assert.equal(practiceCatalog(project)[0].status, "review");
  assert.equal(practiceCatalog(project)[0].statusLabel, "待核对");
});

test("captured page can locate an unscoped question but absent page never falls back to current progress", () => {
  const project = fixture();
  const message = { id: "m", role: "assistant", content: asContent(), readingContext: { sourceId: "book", page: 3 } };
  project.chats[0].messages = [message];
  const [entry] = practiceCatalog(project);
  assert.equal(entry.scopeId, "chapter:1");
  assert.equal(entry.scopeTitle, "第一章");
  delete message.readingContext;
  project.page = 18;
  assert.equal(practiceCatalog(project)[0].scopeId, "project");
});

test("catalog display metadata never derives summaries from answer keys, explanations, or raw content", () => {
  const project = fixture();
  const q = { ...question, type: "short", options: [], answer: "SECRET_ANSWER", explanation: "SECRET_EXPLANATION" };
  project.chats[0].messages = [{ id: "m", role: "assistant", content: asContent(q) }];
  const [entry] = practiceCatalog(project);
  const { object, ...displayMetadata } = entry;
  assert.ok(!JSON.stringify(displayMetadata).includes("SECRET"));
  assert.equal(object.question.answer, "SECRET_ANSWER", "the shared answer card still needs the key to grade after submission");
  assert.equal(object.question.prompt, q.prompt);
  assert.equal(entry.status, "unanswered");
});
