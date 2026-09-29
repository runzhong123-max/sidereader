import test from "node:test";
import assert from "node:assert/strict";
import { companionWidth, splitBounds } from "../src/study-layout.mjs";
import { cardDockPosition, objectDropPosition } from "../src/object-transfer.mjs";

test("split depends on actual content space and protects both reading widths", () => {
  assert.equal(splitBounds(790).canSplit, false);
  assert.equal(splitBounds(800).canSplit, false);
  assert.equal(splitBounds(800, true).canSplit, false);
  for (const width of [900, 1100, 1440, 1920]) {
    for (const ratio of [-2, .2, .5, .8, 8, NaN]) {
      const result = companionWidth(width, ratio, true);
      assert.ok(result >= 400);
      assert.ok(width - 12 - result >= 440);
    }
  }
});

test("narrow and unknown containers remain finite until single pane takes over", () => {
  for (const width of [0, -1, NaN, 390, 667]) {
    assert.equal(splitBounds(width).canSplit, false);
    assert.ok(Number.isFinite(companionWidth(width)));
  }
});

test("menus, native drops, floating docks and content layout share one split boundary", () => {
  for (const width of [800,820,850,851,852,900]) {
    const expected = width >= 852;
    assert.equal(splitBounds(width,false).canSplit,expected,`chat at ${width}`);
    assert.equal(splitBounds(width,true).canSplit,expected,`object at ${width}`);
    for (const kind of ["paper","object","card"])
      assert.equal(objectDropPosition(1,width,kind),expected ? "left" : "main");
    assert.equal(cardDockPosition(1,300,width,700),expected ? "left" : null);
  }
});
