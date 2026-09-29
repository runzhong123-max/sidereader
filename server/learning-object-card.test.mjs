import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { questionRevision } from "../src/question-state.mjs";

// Exercise the real card markup without a simulated browser or CSS runtime.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/components/LearningObjectCard.tsx", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  plugins: [{ name: "server-render-dependencies", setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: "styles", namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    builder.onResolve({ filter: /^[^./]/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { default: LearningObjectCard } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const base = { id: "q", type: "choice", prompt: "选择一个答案", options: ["甲", "乙"], answer: "1", explanation: "SUPPLIED_EXPLANATION" };

function renderQuestion(question, submitted = false, result, props = {}) {
  const object = { id: "question:set:q", kind: "question", title: "练习题", content: "", question };
  const attempts = submitted ? [{
    id: "a", objectId: object.id, prompt: question.prompt, answer: "乙", answerValue: "1",
    questionRevision: questionRevision(question), result: result || (question.type === "short" ? "needs-review" : "correct"),
    assisted: false, feedback: "", at: "2026-09-24",
  }] : [];
  return renderToStaticMarkup(createElement(LearningObjectCard, { object, attempts, onCitation() {}, onAttempt() {}, ...props }));
}

test("missing textbook keys render provenance and pending feedback without revealing a key or self-grading controls", () => {
  for (const type of ["choice", "boolean", "short"]) {
    const html = renderQuestion({ ...base, type, answerStatus: "missing", sourceQuestionNumber: "2.4", anchors: [{ sourceId: "book", page: 31, title: "教材" }] }, true);
    assert.match(html, /原题 2\.4/);
    assert.match(html, /查看题目原文：教材，第 31 页/);
    assert.match(html, /作答已记录，待核对/);
    assert.match(html, /本题暂未附参考答案/);
    assert.match(html, /可回原对话请 Tutor 核对/);
    assert.doesNotMatch(html, /参考答案：|SUPPLIED_EXPLANATION|基本正确|需要补充|回答正确|原书未提供答案/);
  }
});

test("deferring a question never reveals its answer and it stays directly answerable", () => {
  for (const type of ["choice", "boolean", "short"]) {
    const html = renderQuestion({ ...base, type }, true, "skipped");
    assert.match(html, /已暂时跳过，可以稍后继续作答/);
    assert.match(html, /提交答案/);
    assert.doesNotMatch(html, /参考答案|SUPPLIED_EXPLANATION|再做一次/);
    assert.match(html, type === "short" ? /<textarea/ : /type="radio"/);
  }
});

test("a wrong answer has one question discussion action without another header reference button", () => {
  const html = renderQuestion(base, true, "incorrect", { onReferenceQuestion() {} });
  assert.equal((html.match(/>问问这题<\/button>/g) || []).length, 1);
  assert.match(html, /把这道题和作答带入对话，问题由你发送/);
  assert.doesNotMatch(html, /question-reference-button|>引用<\/span>/);
});

test("a standalone question offers its own lazy discussion while inline questions keep reference semantics", () => {
  const standalone = renderQuestion(base, true, "incorrect", { onAskQuestion() {}, onReferenceQuestion() {} });
  assert.equal((standalone.match(/>问问这题<\/button>/g) || []).length, 1);
  assert.match(standalone, /打开这道题的对话，问题由你发送/);
  assert.doesNotMatch(standalone, /把这道题和作答带入对话/);
  const inline = renderQuestion(base, false, undefined, { onReferenceQuestion() {} });
  assert.match(inline, /把这道题和作答带入对话，问题由你发送/);
});

test("provided answers remain hidden until submission and short answers retain explicit self-assessment", () => {
  const unsubmitted = renderQuestion(base);
  assert.match(unsubmitted, /提交答案/);
  assert.doesNotMatch(unsubmitted, /参考答案|SUPPLIED_EXPLANATION/);
  const submitted = renderQuestion(base, true);
  assert.match(submitted, /回答正确/);
  assert.match(submitted, /参考答案：乙/);
  const short = renderQuestion({ ...base, type: "short" }, true);
  assert.match(short, /基本正确/);
  assert.match(short, /需要补充/);
});
