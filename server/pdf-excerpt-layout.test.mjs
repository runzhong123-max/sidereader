import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { locatePdfFormulae } from "../src/pdf-excerpt-layout.mjs";

const viewport = { width: 600, height: 800 };
const span = (text, x, y, width = 30, height = 10) => ({ text, x, y, width, height });
const equation = (label, y) => [span("x = 1", 240, y, 75), span(label, 480, y, 35)];

test("exact equation labels select the source pixels and preserve known excerpt offsets", () => {
  const excerpt = "Before\nx = 1 (9.2)\nAfter";
  const [crop] = locatePdfFormulae(equation("(9.2)", 120), viewport, excerpt);
  assert.equal(crop.label, "(9.2)");
  assert.equal(excerpt.slice(crop.start, crop.end), "x = 1 (9.2)");
  assert.ok(crop.bounds.x < 240 && crop.bounds.x + crop.bounds.width > 515);
  assert.ok(crop.bounds.y <= 120 && crop.bounds.y + crop.bounds.height >= 130);
});

test("a separate equation number still locates its exact body across PDF whitespace", () => {
  const body = "R(c | x) = 1 - P(c | x)";
  const excerpt = "此时条件风险\n(7.5)\n  R(c | x) = 1 -\nP(c | x)  \n于是选择类别。";
  const items = [span(body, 220, 120, 220), span("(7.5)", 480, 120, 35)];
  const [crop] = locatePdfFormulae(items, viewport, excerpt);
  assert.equal(excerpt.slice(crop.start, crop.end), "R(c | x) = 1 -\nP(c | x)");
  assert.equal(excerpt.slice(0, crop.start), "此时条件风险\n(7.5)\n  ");
  assert.equal(excerpt.slice(crop.end), "  \n于是选择类别。");
});

test("a normalized body that occurs more than once never chooses a replacement by proximity", () => {
  const body = "R(c | x) = 1 - P(c | x)";
  const excerpt = `前文 ${body}\n(7.5)\nR(c|x)=1-P(c|x)\n结论`;
  const items = [span(body, 220, 120, 220), span("(7.5)", 480, 120, 35)];
  const [crop] = locatePdfFormulae(items, viewport, excerpt);
  assert.equal(crop.start, undefined);
  assert.equal(crop.end, undefined);
});

test("fallback matching never reorders symbols, repairs OCR, or substitutes a short fragment", () => {
  for (const [cropText, sourceBody] of [
    ["R(c|x)=1-P(c|x)", "1-P(c|x)=R(c|x)"],
    ["R(c|x)=1-P(c|x)", "R(c|x)=I-P(c|x)"],
    ["x = 1", "x = 1"],
  ]) {
    const [crop] = locatePdfFormulae([span(cropText, 220, 120, 220), span("(7.5)", 480, 120, 35)], viewport, `(7.5)\n${sourceBody}`);
    assert.equal(crop.start, undefined, sourceBody);
    assert.equal(crop.end, undefined, sourceBody);
  }
});

test("a proven same-line range still wins before the conservative body fallback", () => {
  const excerpt = "Earlier x = 1\nx = 1 (9.2)\nAfter";
  const [crop] = locatePdfFormulae(equation("(9.2)", 120), viewport, excerpt);
  assert.equal(excerpt.slice(crop.start, crop.end), "x = 1 (9.2)");
});

test("the PDF's original item order can exactly match a fraction whose baseline order differs", () => {
  const body = "P(c|x) =\nP(c) P(x|c)\nP(x)";
  const items = [span("P(c|x) =", 220, 120, 65), span("P(c) P(x|c)", 290, 110, 90), span("P(x)", 310, 135, 35), span("(4.18)", 480, 120, 35)];
  const excerpt = `See (4.18) for the result.\n(4.18)\n${body}\nAfter`;
  const [crop] = locatePdfFormulae(items, viewport, excerpt);
  assert.equal(crop.text, "P(c) P(x|c) P(c|x) = P(x)");
  assert.equal(excerpt.slice(crop.start, crop.end), body);
  assert.equal(excerpt.slice(0, crop.start), "See (4.18) for the result.\n(4.18)\n");
  const [repeated] = locatePdfFormulae(items, viewport, `(4.18)\n${body}\nRepeated\n${body}`);
  assert.equal(repeated.start, undefined);
  const [reordered] = locatePdfFormulae(items, viewport, "(4.18)\nP(x) P(c|x) = P(c) P(x|c)");
  assert.equal(reordered.start, undefined, "neither observed PDF order matches this permutation");
});

test("a verified unique equation number replaces only its isolated math line despite OCR glyph differences", () => {
  const samples = [
    { label: "(7.11)", crop: "θ_c = arg max LL(θ_c)", source: "0c = arg m ax LL(^C) . (7.11)", next: "ec" },
    { label: "(7.3)", crop: "h*(x) = c arg min R(c|x)", source: "h*(x) = arg min R(c | x) , (7.3)", next: "c ey" },
  ];
  for (const sample of samples) {
    const excerpt = `原公式前的说明。\n${sample.source}\n${sample.next}\n这里继续解释该公式。`;
    const items = [span(sample.crop, 220, 120, 220), span(sample.label, 480, 120, 35)];
    const [crop] = locatePdfFormulae(items, viewport, excerpt);
    assert.equal(excerpt.slice(crop.start, crop.end), sample.source);
    assert.equal(excerpt.slice(0, crop.start), "原公式前的说明。\n");
    assert.equal(excerpt.slice(crop.end), `\n${sample.next}\n这里继续解释该公式。`);
  }
});

test("number-based replacement rejects prose, cross-line equations, and ambiguous page or excerpt anchors", () => {
  const items = [span("θ_c = arg max LL(θ_c)", 220, 120, 220), span("(7.11)", 480, 120, 35)];
  for (const excerpt of [
    "此时 0c = arg m ax LL(^C) . (7.11)",
    "The estimate is 0c = arg m ax LL(^C) . (7.11)",
    "0c =\narg m ax LL(^C) . (7.11)",
    "Refer to (7.11).\n0c = arg m ax LL(^C) . (7.11)",
  ]) {
    const [crop] = locatePdfFormulae(items, viewport, excerpt);
    assert.equal(crop.start, undefined, excerpt);
  }
  const duplicatePageItems = [...items, span("θ_c = arg max LL(θ_c)", 220, 220, 220), span("(7.11)", 480, 220, 35)];
  const crops = locatePdfFormulae(duplicatePageItems, viewport, "0c = arg m ax LL(^C) . (7.11)");
  assert.equal(crops.length, 2);
  assert.ok(crops.every(crop => crop.start === undefined));
});

test("matching accepts split label glyphs, fullwidth parentheses, and arbitrary chapter numbers", () => {
  const items = [span("a+b = c", 250, 120, 85), span("（", 480, 120, 5), span("12.37", 485, 120, 25), span("）", 510, 120, 5)];
  const [crop] = locatePdfFormulae(items, viewport, "公式(12.37)");
  assert.equal(crop.label, "(12.37)");
  assert.equal(crop.start, undefined, "a floating label is not enough to delete source prose");
});

test("body references, page headings, marginal notes, and unmatched labels are not equations", () => {
  assert.deepEqual(locatePdfFormulae([span("See equation (9.2) in the following chapter", 170, 120, 345)], viewport, "(9.2)"), []);
  assert.deepEqual(locatePdfFormulae(equation("(9.2)", 120), viewport, "(9.3)"), []);
  assert.deepEqual(locatePdfFormulae([span("Introduction", 240, 120, 100), span("(9.2)", 480, 120, 35)], viewport, "(9.2)"), []);
  const [crop] = locatePdfFormulae([
    span("页眉标题以及说明文字", 50, 25, 400), span("边注文字", 50, 120, 90), ...equation("(9.2)", 120),
    span("这是公式之后完整的正文段落", 170, 157, 340),
  ], viewport, "(9.2)");
  assert.ok(crop.bounds.x > 140);
  assert.ok(crop.bounds.y > 25 && crop.bounds.y + crop.bounds.height < 157);
});

test("fraction numerator, denominator and nearby small scripts remain inside the crop", () => {
  const items = [span("P(x) =", 220, 120, 60), span("P(x,c)", 290, 110, 65), span("P(c)", 300, 134, 35),
    span("i", 350, 139, 5, 6), span("(4.18)", 480, 120, 35)];
  const [crop] = locatePdfFormulae(items, viewport, "(4.18)");
  assert.ok(crop.bounds.y <= 110);
  assert.ok(crop.bounds.y + crop.bounds.height >= 145);
  assert.match(crop.text, /P\(c\)/);
  assert.equal(crop.start, undefined);
});

test("compact defaults to two crops; caller can request one or all matched formulae", () => {
  const items = [...equation("(1.1)", 100), ...equation("(1.2)", 200), ...equation("(1.3)", 300)];
  const excerpt = "(1.1), (1.2), (1.3)";
  assert.equal(locatePdfFormulae(items, viewport, excerpt).length, 2);
  assert.equal(locatePdfFormulae(items, viewport, excerpt, { maxCrops: 1 }).length, 1);
  assert.equal(locatePdfFormulae(items, viewport, excerpt, { maxCrops: 9 }).length, 3);
});

test("native PDF.js transforms map to the supplied top-left viewport and scale", () => {
  const items = [
    { str: "x = 1", transform: [10, 0, 0, 10, 240, 680], width: 75, height: 10 },
    { str: "(9.2)", transform: [10, 0, 0, 10, 480, 680], width: 35, height: 10 },
  ];
  const [a] = locatePdfFormulae(items, { ...viewport, transform: [1, 0, 0, -1, 0, 800] }, "(9.2)");
  const [b] = locatePdfFormulae(items, { width: 1200, height: 1600, transform: [2, 0, 0, -2, 0, 1600] }, "(9.2)");
  for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(b.bounds[key] - a.bounds[key] * 2) < .001);
  assert.ok(a.bounds.y < 120 && a.bounds.y + a.bounds.height > 120);
});

const realPdf = new URL("../.local/books/machine-learning.pdf", import.meta.url);
test("real local textbook pages 164 and 166 retain case branches, fractions and argmax scripts", { skip: !existsSync(realPdf) }, async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(readFileSync(realPdf)), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const read = async number => {
      const page = await pdf.getPage(number), content = await page.getTextContent();
      const excerpt = content.items.map(i => i.str || "").join(" ");
      return { excerpt, crops: locatePdfFormulae(content.items, page.getViewport({ scale: 1 }), excerpt, { maxCrops: 9 }) };
    };
    const { excerpt: excerpt164, crops: page164 } = await read(164), { crops: page166 } = await read(166);
    assert.deepEqual(page164.map(c => c.label), ["(7.4)", "(7.5)", "(7.6)", "(7.7)", "(7.8)"]);
    assert.deepEqual(page166.map(c => c.label), ["(7.11)", "(7.13)"], "damaged 7.12/7.14 labels are never guessed");
    const cases = page164[0].bounds;
    assert.ok(cases.y <= 35 && cases.y + cases.height >= 67, "both case branches survive");
    const fraction = page164.at(-1).bounds;
    assert.ok(fraction.y <= 395 && fraction.y + fraction.height >= 419);
    const argmax = page166[0].bounds;
    assert.ok(argmax.x <= 282 && argmax.y <= 62 && argmax.y + argmax.height >= 86);
    const variance = page166[1].bounds;
    assert.ok(variance.y > 178 && variance.y <= 184 && variance.y + variance.height >= 213);
    assert.ok(page164.every(c => c.bounds.x > 160));
    assert.deepEqual(page164.filter(c => c.start !== undefined).map(c => c.label), ["(7.4)", "(7.5)", "(7.6)", "(7.8)"]);
    for (const crop of page164.filter(c => c.start !== undefined && c.label !== "(7.8)"))
      assert.equal(excerpt164.slice(crop.start, crop.end).replace(/\s/g, ""), crop.text.replace(/\s/g, ""));
    const bayes = page164.find(c => c.label === "(7.8)");
    assert.equal(excerpt164.slice(bayes.start, bayes.end).replace(/\s/g, ""), "P{c|X)=P(c)P(xIc)PQ)");
    assert.ok(page166.every(c => c.bounds.x > 160 && c.start === undefined));
  } finally { await task.destroy(); }
});

test("real QA excerpts match exact source-order formula bodies while preserving unmatched OCR and repeated references", { skip: !existsSync(realPdf) }, async () => {
  const samples = JSON.parse(readFileSync(new URL("../docs/qa/source-excerpt-pdf-cases.json", import.meta.url), "utf8"));
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(readFileSync(realPdf)), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const results = new Map();
    for (const sample of samples.filter(sample => [163, 164, 166, 179].includes(sample.page))) {
      const page = await pdf.getPage(sample.page), content = await page.getTextContent();
      results.set(sample.page, { text: sample.text, crops: locatePdfFormulae(content.items, page.getViewport({ scale: 1 }), sample.text, { maxCrops: 9 }) });
    }
    const bayes = results.get(164), bayesCrop = bayes.crops.find(crop => crop.label === "(7.8)");
    assert.equal(bayes.text.slice(bayesCrop.start, bayesCrop.end), "P{c | X)=\nP(c) P(x I c)\nP Q )");
    const estimates = results.get(166), estimate = estimates.crops.find(crop => crop.label === "(7.11)");
    assert.equal(estimates.text.slice(estimate.start, estimate.end), "0c = arg m ax LL(^C) . (7.11)");
    assert.ok(estimates.text.slice(estimate.end).startsWith("\nec\n例如"));
    const decision = results.get(163), decisionCrop = decision.crops.find(crop => crop.label === "(7.3)");
    assert.equal(decision.text.slice(decisionCrop.start, decisionCrop.end), "h*(x) = arg min R(c | x) , (7.3)");
    assert.ok(decision.text.slice(decisionCrop.end).startsWith("\nc ey\n此时"));
    const em = results.get(179), likelihood = em.crops.find(crop => crop.label === "(7.35)");
    assert.equal(em.text.slice(likelihood.start, likelihood.end), "L L(e I X) = lnP(X  I ©) = In£ ZP(X,Z|0)");
    assert.ok(em.text.slice(likelihood.end).includes("于是，以初始值0 °为起点，对式(7.35)"));
    assert.equal((em.text.match(/\(7\.35\)/g) || []).length, 2, "repeated references never become part of the body replacement");
  } finally { await task.destroy(); }
});
