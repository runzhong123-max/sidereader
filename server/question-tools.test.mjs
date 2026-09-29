import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuestionTools, questionToolDefinition } from "./question-tools.mjs";
import { research } from "./research.mjs";

const generated = (extra = {}) => ({
  tool: "create_question_set", title: "折半检查", origin: "generated", presentation: "inline",
  questions: [{ type: "choice", prompt: "16 个候选每轮减半，两轮后剩几个？", options: ["4", "8"], answer: "0", explanation: "16 → 8 → 4", hint: "分两步计算。" }],
  ...extra,
});
const evidence = [{ id: "book:42", sourceId: "book", page: 42, title: "算法教材", text: "习题 2.1 请说明训练误差与泛化误差的区别。\n2.2 二分查找要求数据满足什么条件？A. 有序 B. 无序" }];
const textbook = (extra = {}) => ({
  tool: "create_question_set", title: "本章原题", origin: "textbook", presentation: "collection",
  questions: [{ type: "short", prompt: "请说明训练误差与泛化误差的区别。", options: [], answer: "", explanation: "", sourceQuestionNumber: "2.1", anchors: [{ sourceId: "book", page: 42 }] }],
  ...extra,
});

test("question tool validates its contract and replays identical successful calls without changing IDs", () => {
  const tools = createQuestionTools(), action = generated();
  const first = tools.execute(action), again = tools.execute({ ...action });
  assert.equal(first.ok, true);
  assert.equal(again.id, first.id);
  assert.equal(again.replayed, true);
  assert.equal(tools.questionSets().length, 1);
  assert.equal(tools.questionSets()[0].questions[0].answerStatus, "provided");
  assert.equal(tools.questionSets()[0].questions[0].hint, action.questions[0].hint);
  assert.match(tools.questionSets()[0].questions[0].id, /^question-/);
  const clone = tools.questionSets();
  clone[0].questions[0].answer = "changed";
  assert.equal(tools.questionSets()[0].questions[0].answer, "0");
  assert.ok(!Object.hasOwn(first, "questions"), "tool receipts do not repeat hidden keys to synthesis");
  assert.equal(questionToolDefinition.parameters.properties.questions.maxItems, 12);
});

test("invalid question inputs fail as a whole, expose field paths and do not silently truncate", () => {
  const tool = createQuestionTools();
  const invalid = [
    generated({ title: "x".repeat(121) }),
    generated({ presentation: "inline", questions: Array(3).fill(generated().questions[0]) }),
    generated({ presentation: "collection", questions: Array(13).fill(generated().questions[0]) }),
    generated({ questions: [] }),
    generated({ questions: [{ ...generated().questions[0], answer: "9" }] }),
    generated({ questions: [{ ...generated().questions[0], answer: "" }] }),
    generated({ questions: [{ ...generated().questions[0], options: ["a".repeat(1001), "b"] }] }),
    generated({ questions: [{ type: "boolean", prompt: "对吗？", options: ["是", "否"], answer: "0", explanation: "" }] }),
    generated({ chapterId: "invented" }),
    generated({ questions: [null] }),
  ];
  for (const action of invalid) {
    const result = tool.execute(action);
    assert.equal(result.ok, false, JSON.stringify(action));
    assert.equal(result.error.code, "invalid_arguments");
    assert.ok(result.error.issues[0].path);
  }
  assert.deepEqual(tool.questionSets(), []);
});

test("textbook extraction requires actually read matching text and never guesses a standard answer", () => {
  const tool = createQuestionTools();
  assert.equal(tool.execute(textbook(), []).ok, false);
  assert.equal(tool.execute(textbook({ questions: [{ ...textbook().questions[0], prompt: "未在书中出现的新题干？" }] }), evidence).ok, false);
  assert.equal(tool.execute(textbook({ questions: [{ ...textbook().questions[0], answer: "猜测答案" }] }), evidence).ok, false);
  assert.equal(tool.execute(textbook({ questions: [{ ...textbook().questions[0], sourceQuestionNumber: "99.9" }] }), evidence).ok, false);
  assert.equal(tool.execute(textbook({ questions: [{ ...textbook().questions[0], anchors: [{ sourceId: "book", page: 41 }] }] }), evidence).ok, false);
  assert.equal(tool.execute(textbook(), evidence).ok, true);
  const set = tool.questionSets()[0];
  assert.equal(set.origin, "textbook");
  assert.equal(set.questions[0].answerStatus, "missing");
  assert.equal(set.questions[0].answer, "");
  assert.deepEqual(set.anchors, [{ sourceId: "book", page: 42, title: "算法教材" }]);
  assert.equal(set.questions[0].sourceQuestionNumber, "2.1");
});

test("textbook choices must retain original options and generated anchors also require evidence", () => {
  const tool = createQuestionTools();
  const q = { type: "choice", prompt: "二分查找要求数据满足什么条件？", options: ["有序", "无序"], answer: "", explanation: "", anchors: [{ sourceId: "book", page: 42 }] };
  assert.equal(tool.execute(textbook({ questions: [{ ...q, options: ["有序", "完全随机"] }] }), evidence).ok, false);
  assert.equal(tool.execute(textbook({ questions: [q] }), evidence).ok, true);
  assert.equal(tool.execute(generated({ questions: [{ ...generated().questions[0], anchors: [{ sourceId: "unknown", page: 1 }] }] }), evidence).ok, false);
});

test("textbook matching preserves mathematical signs and decimal points while tolerating OCR whitespace", () => {
  const source = [{ ...evidence[0], text: "3.1 当 x = -1.2 时，求 x²。" }];
  const base = { ...textbook().questions[0], sourceQuestionNumber: "3.1", prompt: "当x=-1.2时，求x²。" };
  assert.equal(createQuestionTools().execute(textbook({ questions: [base] }), source).ok, true);
  for (const prompt of ["当x=1.2时，求x²。", "当x=-12时，求x²。", "当X=-1.2时，求x²。"])
    assert.equal(createQuestionTools().execute(textbook({ questions: [{ ...base, prompt }] }), source).ok, false);
});

test("each run allows two successful products and replay remains available after the budget is full", () => {
  const tool = createQuestionTools();
  const one = tool.execute(generated());
  const two = tool.execute(generated({ title: "第二次练习" }));
  assert.equal(two.ok, true);
  assert.notEqual(two.id, one.id);
  assert.equal(tool.execute(generated({ title: "第三次练习" })).error.code, "question_budget");
  assert.equal(tool.execute(generated()).id, one.id);
  assert.equal(tool.questionSets().length, 2);
});

test("research mock integration executes a creation action even on finish:true and preserves the normal answer", async () => {
  let calls = 0;
  const result = await research({ question: "检验一下我是否理解折半", mode: "learning", chunks: evidence }, {
    complete: async (messages, json) => {
      calls++;
      if (json) {
        const ctx = JSON.parse(messages.at(-1).content);
        assert.equal(ctx.availableTools[0].name, "create_question_set");
        return JSON.stringify({ finish: true, actions: [generated()] });
      }
      const instructions = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      assert.match(instructions, /已成功创建时/);
      assert.match(instructions, /不在正文或新对象中泄露答案/);
      assert.ok(!instructions.includes("16 → 8 → 4"));
      return "准备了一道折半检查，直接作答即可。";
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.questionSets.length, 1);
  assert.equal(result.questionSets[0].presentation, "inline");
  assert.equal(result.research.stopReason, "sufficient");
  assert.equal(result.answer, "准备了一道折半检查，直接作答即可。");
  assert.ok(result.research.trace.some((step) => step.tool === "create_question_set"));
});

test("research returns structured parameter feedback to the next round before finishing", async () => {
  let round = 0;
  const result = await research({ question: "练一道题", chunks: evidence }, {
    complete: async (messages, json) => {
      if (!json) return "练习已经准备好。";
      if (++round === 1) return JSON.stringify({ finish: true, actions: [generated({ questions: [{ ...generated().questions[0], answer: "wrong" }] })] });
      const ctx = JSON.parse(messages.at(-1).content);
      const failure = ctx.toolResults.find((r) => r.ok === false);
      assert.equal(failure.error.code, "invalid_arguments");
      assert.ok(failure.error.issues.some((issue) => issue.path === "questions[0].answer"));
      return JSON.stringify({ finish: true, actions: [generated()] });
    },
  });
  assert.equal(round, 2);
  assert.equal(result.questionSets.length, 1);
});

test("research reads a textbook page before extracting and rejects a claimed source absent from evidence", async () => {
  const chunks = [{ id: "book:1", sourceId: "book", page: 1, title: "算法教材", text: "本页介绍基础概念。" }, ...evidence];
  let round = 0;
  const result = await research({ question: "整理原题", mode: "learning", chunks, anchor: { sourceId: "book", page: 1 } }, {
    complete: async (_messages, json) => {
      if (!json) return "已整理原题，原文答案未导入。";
      return JSON.stringify(++round === 1
        ? { actions: [textbook(), { tool: "read_pages", sourceId: "book", startPage: 42 }], finish: true }
        : { actions: [textbook()], finish: true });
    },
  });
  assert.equal(round, 2);
  assert.equal(result.questionSets.length, 1);
  assert.equal(result.questionSets[0].questions[0].answerStatus, "missing");
  assert.ok(result.research.trace.some((t) => t.tool === "tool-error"));
});

test("ordinary QA and a disconnected model never fabricate question products", async () => {
  const noModel = await research({ question: "给我练习题", chunks: evidence }, {});
  assert.deepEqual(noModel.questionSets, []);
  assert.equal(noModel.mode, "retrieval");
  const answer = await research({ question: "不要出题，只解释概念", chunks: evidence }, {
    complete: async (_messages, json) => json ? '{"finish":true,"actions":[]}' : "概念说明。",
  });
  assert.deepEqual(answer.questionSets, []);
  assert.equal(answer.answer, "概念说明。");
});
