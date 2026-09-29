import test from "node:test";
import assert from "node:assert/strict";
import { findSourcePages } from "../src/source-search.mjs";

test("overlapping retrieval chunks yield one full-page search result, preserving formula syntax", () => {
  const page = "开篇。".repeat(100) + "核方法 $K(x,y)=\\phi(x)^T\\phi(y)$ 用于内积。";
  const source = { id: "book", title: "教材", pages: [page], chunks: [{ text: page.slice(0, 320) }, { text: page.slice(280) }] };
  const before = JSON.stringify(source);
  const results = findSourcePages([source], "核方法");
  assert.equal(results.length, 1);
  assert.equal(results[0].c.text, page);
  assert.equal(results[0].c.page, 1);
  assert.equal(JSON.stringify(source), before);
});

test("page results retain source identity, literal matching and a bounded stable order", () => {
  const sources = [{ id: "a", title: "A", pages: ["nothing", "a+b", "A+B"] }, { id: "b", title: "B", pages: ["a+b"] }];
  const results = findSourcePages(sources, " A+B ", 2);
  assert.deepEqual(results.map(({ c }) => [c.sourceId, c.page]), [["a", 2], ["a", 3]]);
  assert.equal(findSourcePages(sources, "").length, 0);
  assert.equal(findSourcePages(sources, "absent").length, 0);
});
