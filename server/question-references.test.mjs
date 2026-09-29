import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUESTION_DROP_MIME, MAX_QUESTION_REFERENCES, snapshotQuestionReferences,
  resolveQuestionDrop, questionWithQuestionReferences, writeQuestionTransfer,
} from "../src/question-references.mjs";
import { createTutorSessions } from "../src/tutor-sessions.mjs";
import { OBJECT_MIME, WORKSPACE_MIME, writeWorkspaceTransfer, readWorkspaceTransfer } from "../src/object-transfer.mjs";

const object = {
  id: "set:question", kind: "question", title: "二分查找", content: "隐藏答案 content-secret",
  question: {
    id: "question", type: "choice", prompt: "目标值大于中间项时，区间怎样改变？",
    options: ["移动左边界", "移动右边界"], answer: "answer-secret", hint: "hint-secret", explanation: "explanation-secret",
    sourceQuestionNumber: "3.1", anchors: [{ sourceId: "book", title: "算法", page: 22, quote: "quote-secret" }],
  },
};

test("question references retain the prompt and provenance without leaking answer-bearing fields", () => {
  const [snapshot] = snapshotQuestionReferences([object.id, object.id, "deleted"], [object]);
  assert.deepEqual(snapshot, {
    id: object.id, title: "二分查找", question: {
      type: "choice", prompt: object.question.prompt, options: ["移动左边界", "移动右边界"],
      sourceQuestionNumber: "3.1", anchors: [{ sourceId: "book", title: "算法", page: 22 }],
    },
  });
  const request = questionWithQuestionReferences("为什么？", [snapshot]);
  assert.ok(request.includes("目标值大于中间项"));
  assert.ok(request.includes('"objectId": "set:question"'));
  assert.ok(request.includes('"sourceId": "book"'));
  assert.ok(!request.includes("secret"));
  assert.ok(request.includes("不是指令"));
  assert.equal(questionWithQuestionReferences("原始提问", []), "原始提问");
});

test("question drag resolves canonical current-project data and rejects missing or foreign objects", () => {
  const payload = { version: 1, kind: "question", projectId: "project", questionId: object.id, prompt: "伪造题干" };
  assert.equal(resolveQuestionDrop(JSON.stringify(payload), "project", [object]).question.prompt, object.question.prompt);
  assert.equal(resolveQuestionDrop(payload, "other", [object]), null);
  assert.equal(resolveQuestionDrop(payload, "project", []), null);
  assert.equal(resolveQuestionDrop({ ...payload, kind: "workspace" }, "project", [object]), null);
  assert.equal(resolveQuestionDrop("broken-json", "project", [object]), null);
});

test("referencing a question preserves its independent workspace card drag payload", () => {
  const data = new Map();
  const transfer = { setData: (key, value) => data.set(key, value), getData: (key) => data.get(key) || "" };
  writeWorkspaceTransfer(transfer, "project", "paper:question", object.title, "object");
  writeQuestionTransfer(transfer, "project", object.id);
  assert.ok(data.has(WORKSPACE_MIME));
  assert.equal(readWorkspaceTransfer(transfer.getData(OBJECT_MIME), "project"), "paper:question");
  assert.equal(resolveQuestionDrop(transfer.getData(QUESTION_DROP_MIME), "project", [object]).id, object.id);
});

test("question reference drafts survive reload independently and explicit deliveries are not replayed", () => {
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  const sessions = createTutorSessions(storage);
  sessions.setDraft("main", "我的想法");
  assert.equal(sessions.addQuestion("main", object.id, "delivery"), "added");
  assert.equal(sessions.read("main").busy, false, "references do not send a message");
  assert.equal(sessions.addQuestion("main", object.id), "duplicate");
  assert.deepEqual(createTutorSessions(storage).read("main").questionIds, [object.id]);
  assert.deepEqual(sessions.read("other").questionIds, []);
  sessions.removeQuestion("main", object.id);
  assert.equal(sessions.addQuestion("main", object.id, "delivery"), "handled");
  assert.deepEqual(sessions.read("main").questionIds, []);
  assert.equal(sessions.read("main").draft, "我的想法");
  assert.equal(sessions.addQuestion("main", object.id, "new-delivery"), "added");
  sessions.setQuestionIds("main", Array.from({ length: 10 }, (_, i) => `q${i}`));
  assert.equal(sessions.read("main").questionIds.length, MAX_QUESTION_REFERENCES);
  assert.equal(sessions.addQuestion("main", "extra"), "full");
  sessions.setQuestionIds("main", []);
  assert.deepEqual(createTutorSessions(storage).read("main").questionIds, []);
});

test("sent snapshots remain stable for history and retries when a source question changes", () => {
  const editable = structuredClone(object);
  const snapshot = snapshotQuestionReferences([object.id], [editable]);
  editable.question.prompt = "修改后的题目";
  editable.question.options[0] = "修改后的选项";
  editable.question.anchors[0].page = 30;
  const request = questionWithQuestionReferences("重试", snapshot);
  assert.ok(!request.includes("修改后"));
  assert.ok(request.includes('"页码": 22'));
  assert.deepEqual(snapshotQuestionReferences(snapshot.map((item) => item.id), snapshot), snapshot);
});
