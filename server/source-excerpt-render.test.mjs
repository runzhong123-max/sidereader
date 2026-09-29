import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  stdin: { contents: `export { default } from './src/components/SourceExcerpt.tsx'`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  plugins: [{ name: "server-render", setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: "styles", namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    builder.onResolve({ filter: /^[^./]/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { default: SourceExcerpt } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const render = (text, options = {}) => renderToStaticMarkup(createElement(SourceExcerpt, { text, ...options }));

test("source headings, emphasis and complete formulas render without answer controls", () => {
  const html = render("## 线性模型\n\n**预测**使用 $f(x)=w^T x+b$。\n\n$$\nR(c_i|x)=\\sum_j \\lambda_{ij}P(c_j|x)\n$$", { compact: false });
  assert.match(html, /source-heading/);
  assert.match(html, /<strong>预测<\/strong>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /<button|复制|展开|<h[1-6]/);
});

test("currency stays prose instead of turning two prices into a mathematical expression", () => {
  const html = render("Costs $10 and $20 today.", { compact: false });
  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /Costs \$10 and \$20 today\./);
});

test("valid formulas with inner spaces still reach the math renderer", () => {
  for (const formula of ["$ p(x) $", "$p(x) $", "$ p(x)$"]) {
    assert.match(render(formula), /class="katex"/);
  }
});

test("numbered original-page formulas stay visible in compact evidence", () => {
  const text = "此时条件风险\nR(c \\ x) = 1 - P(c | x) . (7.5)\n于是，选择最小风险的类别。";
  const formulae = [{ label: "(7.5)", start: text.indexOf("R("), end: text.indexOf("\n于是"), width: 220, height: 38, image: "data:image/png;base64,AAAA" }];
  const html = render(text, { formulae });
  assert.match(html, /source-excerpt-illustrated/);
  assert.match(html, /<img[^>]*class="source-original-formula"/);
  assert.match(html, /alt="原页公式 \(7.5\)"/);
  assert.doesNotMatch(html, /R\(c \\ x\)/);
  const full = render(text, { formulae, compact: false });
  assert.match(full, /source-original-formula/);
  assert.match(full, /于是/);
  assert.doesNotMatch(full, /R\(c \\ x\)/);
});

test("a search near an equation displays local pixels even without a reliable replacement range", () => {
  const text = "此时条件风险\nR(c \\ x) = 1 - P(c | x) . (7.5)\n于是，选择最小风险的类别。";
  const formulae = [{ label: "(7.5)", width: 220, height: 38, image: "data:image/png;base64,AAAA" }];
  assert.match(render(text, { formulae, query: "条件风险" }), /source-original-formula/);
  const full = render(text, { formulae, compact: false });
  assert.ok(full.indexOf("source-original-formula") < full.indexOf("于是"));
});

test("a late equation is paired with its own introduction rather than unrelated opening prose", () => {
  const text = "这里首先计算西瓜的概率。".repeat(30) + "采用平滑修正。\np = (n+1)/(N+k) (7.19)";
  const formulae = [{ label: "(7.19)", context: "采用平滑修正。", width: 220, height: 38, image: "data:image/png;base64,AAAA" }];
  const html = render(text, { formulae });
  assert.match(html, /采用平滑修正/);
  assert.doesNotMatch(html, /西瓜/);
});

test("repeated equation references are preserved when its exact body is replaced", () => {
  const body = "p(x) = 1 - p(y)";
  const text = `由式(7.5)可知\n${body}\n(7.5)\n继续参考式(7.5)。`;
  const formulae = [{ label: "(7.5)", start: text.indexOf(body), end: text.indexOf(body) + body.length, width: 220, height: 38, image: "data:image/png;base64,AAAA" }];
  const html = render(text, { formulae, compact: false });
  assert.match(html, /由式\(7.5\)可知/);
  assert.match(html, /继续参考式\(7.5\)/);
  assert.match(html, /source-original-formula/);
});

test("a search chooses the formula whose introduction contains the hit, not a nearby unrelated equation", () => {
  const text = "上一式(7.2)之后，讨论条件风险，以下给出条件风险的计算方式。\n(7.1)";
  const formulae = [
    { label: "(7.2)", width: 220, height: 38, image: "data:image/png;base64,BBBB" },
    { label: "(7.1)", context: "以下给出条件风险的计算方式。", width: 220, height: 38, image: "data:image/png;base64,AAAA" },
  ];
  const html = render(text, { formulae, query: "条件风险" });
  assert.match(html, /alt="原页公式 \(7.1\)"/);
  assert.doesNotMatch(html, /alt="原页公式 \(7.2\)"|上一式/);
  assert.match(html, /<mark>条件风险<\/mark>/);
});

test("search exposes and highlights a late literal hit, never treats query as a regex", () => {
  const text = "这里是无关的长前言。".repeat(60) + "核心观点：a+b 是本段要查的词，核方法在此展开。";
  const html = render(text, { query: "a+b" });
  assert.match(html, /<mark>a\+b<\/mark>/);
  assert.match(html, /核方法/);
  assert.ok((html.match(/这里是无关的长前言/g) || []).length < 15, "the result does not reproduce the entire preface");
});

test("documents cannot introduce active HTML, external image fetches or nested actions", () => {
  const html = render('<script>alert(1)</script>\n\n[链接](https://example.test) ![示意图](https://example.test/track.png)\n\n- [x] 已读\n\n$\\href{javascript:alert(1)}{x}$', { compact: false });
  assert.doesNotMatch(html, /<script|<img|<a\b|<input|<button/);
  assert.match(html, /示意图/);
});

test("snippet markup is safe to place inside the existing search button", () => {
  const html = render("# 标题\n\n正文\n\n- 第一条\n- 第二条\n\n| A | B |\n|---|---|\n| a | b |", { compact: false });
  assert.doesNotMatch(html, /<(?:div|p|h[1-6]|ul|ol|li|table|tr|td|th|pre)\b/);
  assert.match(html, /source-table-cell/);
});

test("corrupted characters remain visibly uncertain rather than silently corrected", () => {
  const html = render("此处的原始值是 \uFFFD，不能猜成希腊字母。", { compact: false });
  assert.match(html, /部分字符或公式需核对原页/);
  assert.match(html, /原始值是/);
});
