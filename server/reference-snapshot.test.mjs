import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { snapshotQuestionReferences } from "../src/question-references.mjs";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/components/ReferenceSnapshot.tsx", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  plugins: [{ name: "dependencies", setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { default: ReferenceSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

test("sent exercise references can be inspected without revealing answers or silently using edited content", () => {
  const object = { id: "q", title: "原来的检测", kind: "question", question: {
    type: "choice", prompt: "原来的题干", options: ["原来的选项"], answer: "SECRET_KEY", explanation: "SECRET_EXPLANATION",
    anchors: [{ sourceId: "book", title: "教材", page: 8 }],
  } };
  const [question] = snapshotQuestionReferences(["q"], [object]);
  object.question.prompt = "修改后的题干";
  const html = renderToStaticMarkup(createElement(ReferenceSnapshot, { question, onReadAnchor() {} }));
  assert.match(html, /查看提问时引用的习题/);
  assert.match(html, /原来的题干/);
  assert.match(html, /原来的选项/);
  assert.match(html, /打开原文：教材，第 8 页/);
  assert.doesNotMatch(html, /SECRET_|修改后的题干|提交答案/);
});

test("sent concept references expose the stored explanation and remain readable without a source", () => {
  const html = renderToStaticMarkup(createElement(ReferenceSnapshot, { concept: { id: "c", name: "线性模型", description: "提问当时的解释" } }));
  assert.match(html, /查看提问时引用的概念：线性模型/);
  assert.match(html, /提问当时的解释/);
  assert.match(html, /提问时的内容/);
  assert.doesNotMatch(html, /打开原文/);
});
