import test from "node:test";
import assert from "node:assert/strict";
import { readingTarget, readingPage } from "../src/reading-state.mjs";

test("resume follows the last reading source even after its tab closes and the project reloads", () => {
  const first = { id: "first", progress: 4, pages: Array(12).fill("") };
  const recent = { id: "recent", progress: 9, pages: Array(20).fill("") };
  const p = JSON.parse(
    JSON.stringify({
      sources: [first, recent],
      activeSource: "recent",
      tabs: [{ kind: "chat", id: "chat" }],
    }),
  );
  assert.equal(readingTarget(p).id, "recent");
  assert.equal(readingPage(readingTarget(p)), 9);
  assert.equal(readingTarget(p, "first").id, "first");
  p.sources = [first];
  assert.equal(readingTarget(p).id, "first");
  p.sources = [];
  assert.equal(readingTarget(p), undefined);
});

test("legacy projects fall back to an open reading tab and invalid progress stays in document bounds", () => {
  const sources = [
    { id: "a", progress: 80, pages: [""] },
    { id: "b", progress: -3, pages: ["", ""] },
  ];
  assert.equal(
    readingTarget({ sources, tabs: [{ kind: "book", sourceId: "b" }] }).id,
    "b",
  );
  assert.equal(readingPage(sources[0]), 1);
  assert.equal(readingPage(sources[1]), 1);
});
