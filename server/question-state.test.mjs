import test from "node:test";
import assert from "node:assert/strict";
import {
  questionRevision,
  questionView,
  questionObject,
  practiceSummary,
} from "../src/question-state.mjs";
import { openPaper, resolvePaperObject } from "../src/paper-state.mjs";
import { attemptContext } from "../src/learning-objects.mjs";

const choice = {
  id: "choice",
  type: "choice",
  prompt: "选择循环不变量",
  options: ["已处理部分有序", "整个数组已经有序"],
  answer: "0",
  explanation: "从已处理部分继续推导。",
};
const short = {
  id: "short",
  type: "short",
  prompt: "解释循环不变量",
  options: [],
  answer: "每轮执行前后保持成立的性质",
  explanation: "",
};
const set = { id: "set", title: "算法", questions: [choice, short] };
const object = questionObject(set.id, choice);
const attempt = {
  id: "attempt-1",
  objectId: object.id,
  prompt: choice.prompt,
  answer: choice.options[0],
  answerValue: "0",
  questionRevision: questionRevision(choice),
  result: "correct",
  assisted: false,
  feedback: choice.explanation,
  at: "2026-09-23T00:00:00Z",
};

test("file question draft and submitted answer survive reopening through the same object identity", () => {
  const drafts = {
    [object.id]: { revision: questionRevision(choice), answer: "1" },
  };
  const reloaded = JSON.parse(JSON.stringify({ drafts, attempts: [attempt] }));
  assert.equal(
    questionView(questionObject(set.id, choice).id, choice, [], reloaded.drafts)
      .answer,
    "1",
  );
  const submitted = questionView(object.id, choice, reloaded.attempts);
  assert.equal(submitted.result.id, attempt.id);
  assert.equal(submitted.answer, "0");
});

test("changing a prompt, option, type, or answer key invalidates old draft and score without deleting history", () => {
  const history = [attempt];
  const drafts = {
    [object.id]: { revision: questionRevision(choice), answer: "0" },
  };
  for (const edit of [
    { prompt: "新的题干" },
    { options: ["不同选项", "B"] },
    { type: "short" },
    { answer: "1" },
  ]) {
    const view = questionView(
      object.id,
      { ...choice, ...edit },
      history,
      drafts,
    );
    assert.equal(view.result, undefined);
    assert.equal(view.answer, "");
  }
  assert.equal(history[0].answer, choice.options[0]);
  assert.equal(history[0].questionRevision, questionRevision(choice));
  assert.equal(
    questionRevision({ ...choice, explanation: "改进解释" }),
    questionRevision(choice),
  );
});

test("missing-answer revisions preserve existing provided-answer hashes and invalidate old grading", () => {
  assert.equal(questionRevision(choice), "q1:47:175e5abe");
  assert.equal(questionRevision({ ...choice, answerStatus: "provided" }), questionRevision(choice));
  assert.equal(questionRevision({ ...choice, sourceQuestionNumber: "1.2", anchors: [{ sourceId: "book", page: 1 }] }), questionRevision(choice));
  const missing = { ...choice, answerStatus: "missing" };
  assert.notEqual(questionRevision(missing), questionRevision(choice));
  assert.equal(questionView(object.id, missing, [attempt]).result, undefined);
  const legacy = { ...attempt, objectId: "message:object:0", questionRevision: undefined };
  assert.equal(questionView(legacy.objectId, missing, [legacy]).result, undefined);
});

test("missing textbook answers stay pending across reloads and cannot inherit correct or self-correct results", () => {
  const missingQuestions = [
    { ...choice, answerStatus: "missing" },
    { ...short, answerStatus: "missing" },
  ];
  const missingSet = { ...set, questions: missingQuestions };
  const history = missingQuestions.map((q, index) => ({
    ...attempt,
    id: `missing-${index}`,
    objectId: questionObject(set.id, q).id,
    questionRevision: questionRevision(q),
    result: index === 0 ? "correct" : "self-correct",
    answerValue: index === 0 ? "0" : "我的推理",
  }));
  const reloaded = JSON.parse(JSON.stringify({ missingSet, history }));
  for (const q of reloaded.missingSet.questions) {
    const state = questionView(questionObject(set.id, q).id, q, reloaded.history);
    assert.equal(state.result.result, "needs-review");
    assert.ok(state.answer);
  }
  assert.deepEqual(practiceSummary(reloaded.missingSet, reloaded.history), {
    total: 2, submitted: 2, objectiveSubmitted: 0, objectiveCorrect: 0,
    selfReviewed: 0, selfCorrect: 0, needsReview: 2, unanswered: 0,
  });
  assert.equal(history[0].result, "correct");
  const skipped = { ...history[0], result: "skipped" };
  assert.equal(questionView(skipped.objectId, missingQuestions[0], [skipped]).result.result, "skipped");
  assert.equal(practiceSummary(missingSet, [skipped]).unanswered, 2);
});

test("legacy immutable generated objects restore results, but editable file questions cannot assume the old key", () => {
  const legacy = {
    ...attempt,
    questionRevision: undefined,
    answerValue: undefined,
  };
  assert.equal(questionView(object.id, choice, [legacy]).result, undefined);
  const generated = { ...legacy, objectId: "message:object:0" };
  assert.equal(
    questionView(generated.objectId, choice, [generated]).result.id,
    attempt.id,
  );
  assert.equal(
    questionView(generated.objectId, choice, [generated]).answer,
    "0",
  );
});

test("practice counts only submitted answers and keeps self assessment separate from objective correctness", () => {
  const drafts = {
    [object.id]: { revision: questionRevision(choice), answer: "0" },
  };
  const unsubmitted = practiceSummary(set, [], drafts);
  assert.equal(unsubmitted.submitted, 0);
  assert.equal(unsubmitted.objectiveCorrect, 0);
  assert.equal(unsubmitted.unanswered, 2);
  const self = {
    ...attempt,
    id: "self",
    objectId: questionObject(set.id, short).id,
    questionRevision: questionRevision(short),
    prompt: short.prompt,
    result: "self-correct",
    answer: "性质不变",
    answerValue: "性质不变",
  };
  const summary = practiceSummary(set, [attempt, self]);
  assert.equal(summary.submitted, 2);
  assert.equal(summary.objectiveSubmitted, 1);
  assert.equal(summary.objectiveCorrect, 1);
  assert.equal(summary.selfReviewed, 1);
  assert.equal(summary.selfCorrect, 1);
  const retry = {
    [object.id]: {
      revision: questionRevision(choice),
      answer: "",
      retry: true,
    },
  };
  assert.equal(practiceSummary(set, [attempt, self], retry).submitted, 1);
  assert.equal(
    questionView(object.id, choice, [attempt], retry).result,
    undefined,
  );
  assert.equal(
    questionView(object.id, choice, [attempt], retry).assisted,
    true,
  );
});

test("skipping without seeing help stays unassisted; viewed hints and earlier answers remain assisted", () => {
  const skipped = { ...attempt, result: "skipped", answer: "", answerValue: "", feedback: "" };
  const state = questionView(object.id, choice, [skipped]);
  assert.equal(state.result.result, "skipped");
  assert.equal(state.assisted, false);
  assert.equal(practiceSummary(set, [skipped]).submitted, 0);
  assert.equal(questionView(object.id, choice, [{ ...attempt, result: "hint-viewed" }, skipped]).assisted, true);
  assert.equal(questionView(object.id, choice, [attempt, skipped]).assisted, true);
  assert.equal(questionView(object.id, choice, [skipped], {
    [object.id]: { revision: questionRevision(choice), answer: "", hint: true },
  }).assisted, true);
});

test("question papers resolve editable source while retaining paper identity and legacy discussion", () => {
  const paper = {
    id: "paper",
    parentId: "questions",
    title: object.title,
    object,
  };
  const project = { sets: [set], chats: [{ id: "paper", messages: [{ id: "discussion", content: "这里为什么成立" }] }], tabs: [] };
  const opened = openPaper(project, paper);
  assert.equal(opened.chats, project.chats);
  const edited = {
    ...opened,
    sets: [
      {
        ...set,
        questions: [{ ...choice, prompt: "修改过的题干", answer: "1" }, short],
      },
    ],
  };
  const resolved = resolvePaperObject(edited, paper);
  assert.equal(resolved.question.prompt, "修改过的题干");
  assert.equal(resolved.question.answer, "1");
  const reopened = openPaper(edited, {
    ...paper,
    id: "duplicate",
    object: resolved,
  });
  assert.equal(reopened.papers.length, 1);
  assert.equal(reopened.activeTab, "paper");
  assert.equal(reopened.papers[0].object.question.answer, "1");
  assert.equal(reopened.chats[0].messages[0].id, "discussion");
  assert.equal(
    resolvePaperObject({ ...reopened, sets: [] }, reopened.papers[0]).question
      .answer,
    "1",
  );
});

test("generated objects stay immutable snapshots even when reopening supplies different content", () => {
  const paper = {
    id: "paper",
    parentId: "chat",
    title: "生成的题目",
    object: { ...object, id: "message:object:0" },
  };
  const opened = openPaper({ sets: [set], chats: [], tabs: [] }, paper);
  const reopened = openPaper(opened, {
    ...paper,
    id: "other",
    object: { ...paper.object, question: { ...choice, answer: "1" } },
  });
  assert.equal(reopened.papers.length, 1);
  assert.equal(reopened.papers[0].object.question.answer, "0");
});

test("tutor context preserves the version attached to a historical answer", () => {
  const context = attemptContext([attempt]);
  assert.equal(context[0].questionRevision, questionRevision(choice));
  assert.equal(context[0].prompt, choice.prompt);
  assert.equal(context[0].answer, choice.options[0]);
});
