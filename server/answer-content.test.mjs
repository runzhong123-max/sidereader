import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/components/AnswerContent.tsx", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  plugins: [{ name: "render-dependencies", setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: "styles", namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    builder.onResolve({ filter: /^[^./]/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { default: AnswerContent } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
function render(content) {
  return renderToStaticMarkup(createElement(AnswerContent, { content, messageId: "answer", projectId: "project", evidence: [], onCitation() {}, onOpen() {}, onAttempt() {} }));
}

test("formula, table and code remain continuous answer material while keeping stable object actions", () => {
  const content = "先看公式。\n\n$$f(x)=wx+b$$\n\n再核对参数。\n\n| 参数 | 含义 |\n| --- | --- |\n| w | 权重 |\n\n最后是实现。\n\n```python\ny = w * x + b\n```";
  const html = render(content);
  assert.match(html, /先看公式/);
  assert.match(html, /再核对参数/);
  assert.match(html, /最后是实现/);
  assert.match(html, /answer-fragment-formula/);
  assert.match(html, /answer-fragment-table/);
  assert.match(html, /answer-fragment-code/);
  for (let index = 0; index < 3; index++) assert.match(html, new RegExp(`data-object-id="answer:object:${index}"`));
  assert.equal((html.match(/aria-label="展开：/g) || []).length, 3);
  assert.equal((html.match(/class="answer-fragment-drag"/g) || []).length, 3);
  assert.doesNotMatch(html, /class="learning-object[ "]|learning-object-title/);
});

test("interactive practice retains a card and answer form without leaking its key", () => {
  const object = { kind: "question", title: "基本形式检查", question: { type: "choice", prompt: "线性模型包括什么？", options: ["权重与偏置", "只有偏置"], answer: "0", explanation: "SECRET_EXPLANATION" } };
  const html = render(`先检查理解。\n\n\`\`\`sidereader-object\n${JSON.stringify(object)}\n\`\`\``);
  assert.match(html, /class="learning-object /);
  assert.match(html, /线性模型包括什么/);
  assert.match(html, /提交答案/);
  assert.doesNotMatch(html, /answer-fragment-question|SECRET_EXPLANATION|参考答案/);
});
