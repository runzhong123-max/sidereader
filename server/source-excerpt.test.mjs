import test from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { prepareSourceExcerpt } from "../src/source-excerpt.mjs";

test("PDF soft wraps reflow Chinese and English while retaining paragraph boundaries", () => {
  const source = "这是一段中\n文，说明贝叶斯\n分类器。\n\nA narrow PDF column\nwraps a sentence without\nchanging its words.\n\nA state-\nof-the-art model.";
  assert.deepEqual(prepareSourceExcerpt(source), {
    markdown: "这是一段中文，说明贝叶斯分类器。\n\nA narrow PDF column wraps a sentence without changing its words.\n\nA state-of-the-art model.",
    truncated: false,
    hasUncertainText: false,
  });
  assert.equal(source.includes("中\n文"), true);
});

test("only compact views omit recognizable page metadata, preserving a full source view", () => {
  const source = "150 第7章 贝叶斯分类器\nN 为正态分布，参见附\n录 C.I.7.\n\n不要猜测 OCR 中的 I 是数字 1。";
  const compact = prepareSourceExcerpt(source, { maxChars: 220 });
  assert.equal(compact.markdown, "N 为正态分布，参见附录 C.I.7.\n\n不要猜测 OCR 中的 I 是数字 1。");
  assert.equal(compact.truncated, true);
  assert.match(prepareSourceExcerpt(source).markdown, /^150 第7章 贝叶斯分类器/);
  assert.match(prepareSourceExcerpt(source, { maxChars: 220, query: "贝叶斯分类器" }).markdown, /150 第7章 贝叶斯分类器/);
  assert.match(prepareSourceExcerpt("150 participants\nwere tested.", { maxChars: 220 }).markdown, /^150 participants were tested\.$/);
});

test("explicit math delimiters normalize while preserving LaTex and code verbatim", () => {
  const source = String.raw`Inline \(p(x \mid y)\) and $E=mc^2$.

\[
\begin{aligned}
x &= \frac{a}{b} \\
y &= x^2
\end{aligned}
\]

$$z = \sum_{i=1}^n x_i$$

` + "`\\(literal\\)`\n\n```tex\n\\[literal\\]\n$$unparsed$$\n```";
  const result = prepareSourceExcerpt(source);
  assert.match(result.markdown, /Inline \$p\(x \\mid y\)\$ and \$E=mc\^2\$\./);
  assert.ok(result.markdown.includes("$$\n\\begin{aligned}\nx &= \\frac{a}{b} \\\\\ny &= x^2\n\\end{aligned}\n$$"));
  assert.ok(result.markdown.includes("$$\nz = \\sum_{i=1}^n x_i\n$$"));
  assert.ok(result.markdown.includes("`\\(literal\\)`"));
  assert.ok(result.markdown.includes("```tex\n\\[literal\\]\n$$unparsed$$\n```"));
  assert.equal(result.hasUncertainText, false);
});

test("Markdown headings, lists, tables, fences and hard breaks retain their structure", () => {
  const source = "# Heading\n\n- first item\n  continuation\n- second item\n\n| Name | Value |\n| --- | ---: |\n| alpha | 1 |\n\nTitle\n=====\n\nA line  \nthen another\n\n    indented code\n    stays indented";
  const result = prepareSourceExcerpt(source);
  assert.equal(result.markdown, source);
});

test("a literal case-insensitive query near the end is always included with context", () => {
  const source = "Before this section. ".repeat(100) + "The result is C.I.7 [a+b]? EXACT-MATCH in the final paragraph.";
  const result = prepareSourceExcerpt(source, { query: "c.i.7 [a+b]? exact-match", maxChars: 70 });
  assert.ok(result.markdown.startsWith("… "));
  assert.ok(result.markdown.includes("C.I.7 [a+b]? EXACT-MATCH"));
  assert.equal(result.truncated, true);
  assert.ok(result.markdown.length < 120);
  assert.ok(result.markdown.indexOf("C.I.7") <= 37);
});

test("a late hit has little leading context even with a generous compact budget", () => {
  const source = "preface ".repeat(300) + "最后的 MATCH";
  const result = prepareSourceExcerpt(source, { query: "MATCH", maxChars: 220 });
  assert.ok(result.markdown.indexOf("MATCH") <= 37, result.markdown);
  assert.ok(result.markdown.length < 60);
  assert.ok(!result.markdown.startsWith("…\n"));
});

test("compact searches focus a later paragraph even when the whole source fits the character budget", () => {
  const source = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n\nThe MATCH appears here.";
  const compact = prepareSourceExcerpt(source, { query: "MATCH", maxChars: 220 });
  assert.equal(compact.markdown, "… The MATCH appears here.");
  assert.equal(compact.truncated, true);
  assert.equal(prepareSourceExcerpt(source, { query: "MATCH" }).markdown, source);
});

test("compact searches retain the matching list item instead of preceding items", () => {
  const source = "- First item\n- Second item\n- Third item\n- The MATCH item\n  with its continuation\n  - and nested detail\n- Final item";
  const compact = prepareSourceExcerpt(source, { query: "MATCH", maxChars: 220 });
  assert.equal(compact.markdown, "…\n\n- The MATCH item\n  with its continuation\n  - and nested detail\n- Final item");
  assert.equal(compact.truncated, true);
  assert.equal(prepareSourceExcerpt(source, { query: "MATCH" }).markdown, source);
  const ordered = "1. First item\n2. Second item\n3. Third item\n4. The MATCH item";
  assert.equal(prepareSourceExcerpt(ordered, { query: "MATCH", maxChars: 220 }).markdown, "…\n\n4. The MATCH item");
});

test("a query longer than the budget is still visible", () => {
  const query = "this full literal phrase must remain visible";
  const result = prepareSourceExcerpt(`start ${query} ending`, { query, maxChars: 12 });
  assert.ok(result.markdown.includes(query));
});

test("context clipping preserves complete display math, inline math and code", () => {
  const equation = "\\sum_{i=1}^{n} \\frac{QUERY_i}{1 + e^{-x_i}}";
  const variants = [
    { source: `$$${equation}$$`, expected: `$$\n${equation}\n$$` },
    { source: `$${equation}$`, expected: `$${equation}$` },
    { source: "```python\nQUERY = [x for x in range(100)]\nprint(QUERY)\n```", expected: "```python\nQUERY = [x for x in range(100)]\nprint(QUERY)\n```" },
  ];
  for (const variant of variants) {
    const result = prepareSourceExcerpt(`${"Preface. ".repeat(30)}\n\n${variant.source}\n\n${"Afterward. ".repeat(30)}`, { query: "QUERY", maxChars: 18 });
    assert.ok(result.markdown.includes(variant.expected), result.markdown);
    assert.equal(result.hasUncertainText, false);
  }
});

test("a compact table and balanced inline markup are not cut in half", () => {
  const table = "| Name | Value |\n| --- | --- |\n| QUERY | 123 |";
  assert.ok(prepareSourceExcerpt(`Introduction\n\n${table}\n\nConclusion`, { query: "QUERY", maxChars: 8 }).markdown.includes(table));
  for (const syntax of ["**the QUERY result**", "[the QUERY result](https://example.test/a)", "_the QUERY result_"]) {
    assert.ok(prepareSourceExcerpt(`Before ${syntax} after`, { query: "QUERY", maxChars: 5 }).markdown.includes(syntax));
  }
});

test("uncertain extraction is flagged without fabricating symbols or dropping details", () => {
  for (const source of ["OCR \uFFFD and \uE012 remain here.", String.raw`\[x = \frac{a}{`, "f(x) ="]) {
    const result = prepareSourceExcerpt(source);
    assert.equal(result.hasUncertainText, true, source);
    assert.equal(result.markdown, source);
  }
  const result = prepareSourceExcerpt("C.I.7 has l, I, 1, O and 0.\n\nThe price is $10.");
  assert.equal(result.hasUncertainText, false);
  assert.ok(result.markdown.includes("C.I.7 has l, I, 1, O and 0."));
  assert.ok(result.markdown.includes("\\$10"));
  assert.equal(prepareSourceExcerpt("$$x = y").hasUncertainText, true);
  assert.equal(prepareSourceExcerpt("$$x = y").markdown, "\\$\\$x = y");
});

test("prices stay literal for remark-math without swallowing adjoining whitespace", () => {
  assert.equal(prepareSourceExcerpt("Costs $10 and $20 today.").markdown, "Costs \\$10 and \\$20 today.");
  assert.equal(prepareSourceExcerpt("Costs $10-$20; solve $x + y$.").markdown, "Costs \\$10-\\$20; solve $x + y$.");
  assert.equal(prepareSourceExcerpt("Costs \\$10 and \\$20.").markdown, "Costs \\$10 and \\$20.");
});

test("legal math with inner delimiter whitespace remains math while adjacent prices stay literal", () => {
  for (const source of ["$ p(x) $", "$p(x) $", "$ p(x)$"]) {
    const result = prepareSourceExcerpt(source);
    assert.equal(result.markdown, "$p(x)$");
    assert.equal(result.hasUncertainText, false);
  }
  assert.equal(prepareSourceExcerpt("Costs $10 and $20; calculate $ p(x) $.").markdown, "Costs \\$10 and \\$20; calculate $p(x)$.");
  assert.equal(prepareSourceExcerpt("Costs $20; calculate $ p(x) $.").markdown, "Costs \\$20; calculate $p(x)$.");
});

test("visibly split PDF optimization operators are flagged without rewriting the formula", () => {
  const source = "0c = arg m ax LL(^C) . (7.11)";
  const result = prepareSourceExcerpt(source);
  assert.equal(result.hasUncertainText, true);
  assert.equal(result.markdown, source);
  for (const operator of ["arg ma x", "arg m in", "arg mi n"]) {
    assert.equal(prepareSourceExcerpt(`0c = ${operator} LL(^C)`).hasUncertainText, true);
  }
  assert.equal(prepareSourceExcerpt("theta = arg max LL(theta)").hasUncertainText, false);
  assert.equal(prepareSourceExcerpt("theta = arg min LL(theta)").hasUncertainText, false);
});

test("math inside adjacent list items does not loosen or split the list", () => {
  const source = "- The first $x$\n- The second $y$";
  assert.equal(prepareSourceExcerpt(source).markdown, source);
});

test("HTML and hostile source strings remain data without being evaluated or decoded", () => {
  const source = '<script>alert("QUERY")</script>\n\n<img src=x onerror="alert(1)">\n\n&lt;iframe&gt;';
  const result = prepareSourceExcerpt(source);
  assert.equal(result.markdown, source);
  assert.equal(result.hasUncertainText, false);
  assert.equal(prepareSourceExcerpt(source, { query: "QUERY", maxChars: 12 }).markdown.includes("QUERY"), true);
});

test("empty input, CRLF, absent hits and explicit unlimited views are deterministic", () => {
  assert.deepEqual(prepareSourceExcerpt(""), { markdown: "", truncated: false, hasUncertainText: false });
  assert.equal(prepareSourceExcerpt("One\r\nline.\r\n\r\nNext.").markdown, "One line.\n\nNext.");
  assert.equal(prepareSourceExcerpt("One two three four", { query: "absent", maxChars: 6 }).markdown, "One two …");
  assert.equal(prepareSourceExcerpt("Page 1\nall text", { maxChars: Infinity }).truncated, false);
});

test("a real PDF risk formula renders between its introductory and concluding paragraphs", () => {
  const source = "此时条件风险\nR(c | x) = 1 - P(c | x),\n于是，根据条件风险选择类别。";
  const result = prepareSourceExcerpt(source);
  assert.equal(result.markdown, "此时条件风险\n\n$$\nR(c | x) = 1 - P(c | x),\n$$\n\n于是，根据条件风险选择类别。");
  assert.equal(result.hasUncertainText, false);
  assert.match(katex.renderToString("R(c | x) = 1 - P(c | x),", { throwOnError: true }), /katex/);
});

test("Chinese chapter and section titles stay separate and semantic transitions retain paragraphs", () => {
  const source = "第7章 贝叶斯分类器\n7.1 贝叶斯决策论\n在概率框架下进行分\n类。\n此时条件风险\nR(c | x) = 1 - P(c | x),\n于是，根据条件风险选择类别。\n注意：应保留原始符号。\n因此，不要猜测断裂的公式。";
  const result = prepareSourceExcerpt(source);
  assert.equal(result.markdown, "第7章 贝叶斯分类器\n\n7.1 贝叶斯决策论\n\n在概率框架下进行分类。\n\n此时条件风险\n\n$$\nR(c | x) = 1 - P(c | x),\n$$\n\n于是，根据条件风险选择类别。\n\n注意：应保留原始符号。\n\n因此，不要猜测断裂的公式。");
  const compact = prepareSourceExcerpt(source, { maxChars: 220 });
  assert.equal(compact.markdown, result.markdown);
  assert.equal(compact.hasUncertainText, false);
});

test("complete unmarked TeX and exact Unicode scripts produce valid math without guessing glyphs", () => {
  const sources = [String.raw`P(x | c)`, String.raw`\frac{P(c) P(x | c)}{P(x)}`, "μ₁ = 2σ²"];
  const expected = ["P(x | c)", String.raw`\frac{P(c) P(x | c)}{P(x)}`, "μ_{1} = 2σ^{2}"];
  for (let index = 0; index < sources.length; index++) {
    const result = prepareSourceExcerpt(sources[index]);
    assert.equal(result.markdown, `$$\n${expected[index]}\n$$`);
    assert.equal(result.hasUncertainText, false);
    assert.doesNotThrow(() => katex.renderToString(expected[index], { throwOnError: true }));
  }
  assert.equal(prepareSourceExcerpt("后验概率 P(x | c) 以及均值 μ₁ 是本节符号。").markdown,
    "后验概率 $P(x | c)$ 以及均值 $μ_{1}$ 是本节符号。");
});

test("PDF headings without spaces still separate from following prose", () => {
  assert.equal(prepareSourceExcerpt("第7章贝叶斯分类器\n7.1贝叶斯决策论\n正文内容。").markdown,
    "第7章贝叶斯分类器\n\n7.1贝叶斯决策论\n\n正文内容。");
});

test("unclear math, dates, prices and code retain their source instead of speculative reconstruction", () => {
  for (const source of ["0c = arg m ax LL(^C) . (7.11)", String.raw`\frac{a}`, String.raw`\frac{a}{`, "P(x |)", "P( | c)", "P(x | c) =", "2026-09-29", "x = 1", "const x = 1;", "版本 C.I.7，变量 I、l、1、O、0。", "价格 10 元，日期 7.11。"])
    assert.equal(prepareSourceExcerpt(source).markdown, source);
  const code = "```python\nP(x | c)\nμ₁ = 2σ²\n```\n\n`P(x | c)`\n\n    P(x | c)\n    μ₁ = 2σ²";
  assert.equal(prepareSourceExcerpt(code).markdown, code);
  assert.equal(prepareSourceExcerpt("Costs $10 and $20 today.").markdown, "Costs \\$10 and \\$20 today.");
});

test("compact search still focuses newly rendered Unicode math and keeps the complete expression", () => {
  const source = "前文。".repeat(100) + "\nμ₁ = 2σ²\n结论。";
  const result = prepareSourceExcerpt(source, { query: "μ₁", maxChars: 20 });
  assert.ok(result.markdown.includes("$$\nμ_{1} = 2σ^{2}\n$$"));
  assert.ok(!result.markdown.includes("前文"));
  assert.equal(result.truncated, true);
});
