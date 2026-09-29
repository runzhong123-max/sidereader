import test from "node:test";
import assert from "node:assert/strict";
import { citationPreviewPosition } from "../src/citation-preview.mjs";

const viewport = { left: 0, top: 0, width: 1024, height: 768 };
const size = { width: 380, height: 320 };

test("an inline source opens immediately below its citation when space permits", () => {
  const result = citationPreviewPosition({ left: 410, top: 100, bottom: 124 }, viewport, size);
  assert.equal(result.left, 410);
  assert.equal(result.top, 132);
});

test("a citation beside the bottom right edge remains fully visible above the trigger", () => {
  const result = citationPreviewPosition({ left: 985, top: 710, bottom: 734 }, viewport, size);
  assert.equal(result.left + result.width, 1012);
  assert.equal(result.top + size.height, 702);
});

test("a narrow visual viewport clamps both width and position", () => {
  const result = citationPreviewPosition({ left: 315, top: 200, bottom: 224 },
    { left: 0, top: 0, width: 320, height: 460 }, size);
  assert.equal(result.width, 296);
  assert.equal(result.left, 12);
  assert.ok(result.top >= 12);
  assert.ok(result.top + Math.min(size.height, result.maxHeight) <= 448);
});

test("zoomed viewport offsets are respected instead of placing content outside the visible area", () => {
  const visible = { left: 180, top: 90, width: 390, height: 300 };
  const result = citationPreviewPosition({ left: 130, top: 70, bottom: 90 }, visible, size);
  assert.equal(result.left, 192);
  assert.equal(result.top, 102);
  assert.equal(result.width, 366);
  assert.equal(result.maxHeight, 276);
});
