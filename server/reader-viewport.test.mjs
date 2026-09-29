import test from 'node:test';
import assert from 'node:assert/strict';
import { captureReadingAnchor, restoreReadingAnchor, canRestoreReadingSession, readingPageRange, clampReadingPage } from '../src/reader-viewport.mjs';

test('a reader halfway through a page keeps the same passage after a width change', () => {
  const before = [{ page: 1, top: 20, height: 1000 }, { page: 2, top: 1040, height: 1000 }];
  const anchor = captureReadingAnchor(before, 1420, 600);
  assert.deepEqual(anchor, { page: 2, offset: 0.5 });
  const after = [{ page: 1, top: 20, height: 700 }, { page: 2, top: 740, height: 700 }];
  const restored = restoreReadingAnchor(anchor, after, 600);
  assert.equal(restored, 970);
  assert.deepEqual(captureReadingAnchor(after, restored, 600), anchor);
});

test('changing viewport height keeps the reading line at the same passage', () => {
  const pages = [{ page: 1, top: 20, height: 1000 }];
  const anchor = captureReadingAnchor(pages, 300, 600);
  assert.equal(restoreReadingAnchor(anchor, pages, 320), 340);
});

test('inter-page gaps resolve to the following page without negative offsets', () => {
  const pages = [{ page: 1, top: 20, height: 100 }, { page: 2, top: 160, height: 100 }];
  assert.deepEqual(captureReadingAnchor(pages, 10, 600), { page: 2, offset: 0 });
  assert.equal(restoreReadingAnchor({ page: 1, offset: 0 }, pages, 600), 0);
  assert.equal(restoreReadingAnchor({ page: 3, offset: 0.5 }, pages, 600), null);
  assert.equal(captureReadingAnchor([], 0, 600), null);
});

test('session restoration yields to page changes and repeated same-page citation navigation', () => {
  const saved = { anchor: { page: 22, offset: 0.6 }, zoom: 120, textMode: false, navigationKey: 4, evidenceText: '归纳偏好' };
  assert.equal(canRestoreReadingSession(saved, 22, 4), true);
  assert.equal(canRestoreReadingSession(saved, 23, 4), false);
  assert.equal(canRestoreReadingSession(saved, 22, 5, '归纳偏好'), false);
  assert.equal(canRestoreReadingSession(saved, 22, 4, '另一段'), false);
  assert.equal(canRestoreReadingSession(undefined, 22), false);
});

test('chapter navigation clamps stale progress and entered pages without renumbering', () => {
  const range = readingPageRange(441, { start: 22, end: 39 });
  assert.deepEqual(range, { start: 22, end: 39 });
  assert.equal(clampReadingPage(1, range), 22);
  assert.equal(clampReadingPage(100, range), 39);
  assert.equal(clampReadingPage(30, range), 30);
  assert.equal(clampReadingPage(Number.NaN, range), 22);
  const pages = [{ page: 22, top: 20, height: 1000 }, { page: 23, top: 1040, height: 1000 }];
  assert.deepEqual(captureReadingAnchor(pages, 1420, 600), { page: 23, offset: 0.5 });
});

test('chapter bounds intersect the real source and malformed ranges never expose extra pages', () => {
  assert.deepEqual(readingPageRange(50), { start: 1, end: 50 });
  assert.deepEqual(readingPageRange(50, { start: -8, end: 80 }), { start: 1, end: 50 });
  assert.deepEqual(readingPageRange(50, { start: 80, end: 90 }), { start: 50, end: 50 });
  assert.deepEqual(readingPageRange(50, { start: 20, end: 5 }), { start: 20, end: 20 });
  assert.deepEqual(readingPageRange(50, { start: 20.2, end: 29.9 }), { start: 21, end: 29 });
  assert.deepEqual(readingPageRange(0, { start: 1, end: 8 }), { start: 1, end: 0 });
});
