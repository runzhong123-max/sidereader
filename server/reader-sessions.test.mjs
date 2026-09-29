import test from "node:test";
import assert from "node:assert/strict";
import { createReaderSessions } from "../src/reader-sessions.mjs";
import { canRestoreReadingSession, restoreReadingAnchor } from "../src/reader-viewport.mjs";
const snapshot = (page = 22, offset = .6) => ({ sourceId: "book", anchor: { page, offset }, zoom: 135, textMode: false, navigationKey: 4, evidenceText: "old citation" });

test("promotion captures the live passage, zoom and text mode before changing reader views", () => {
  const sessions = createReaderSessions();
  sessions.save("p:reference:chapter", snapshot(22, .1));
  const live = { ...snapshot(23, .7), zoom: 150, textMode: true };
  sessions.register("p:reference:chapter", () => live);
  const copied = sessions.copy("p:reference:chapter", "p:chapter", { sourceId: "book", navigationKey: 9 });
  assert.deepEqual(copied.anchor, { page: 23, offset: .7 });
  assert.equal(copied.zoom, 150);
  assert.equal(copied.textMode, true);
  assert.equal(copied.sessionId, "p:chapter");
  assert.equal(copied.navigationKey, 9);
  assert.equal(copied.evidenceText, undefined);
  assert.equal(canRestoreReadingSession(copied, 23, 9), true);
  assert.equal(restoreReadingAnchor(copied.anchor, [{ page: 23, top: 20, height: 800 }], 600), 460);
  live.anchor.offset = .2;
  copied.anchor.offset = .3;
  assert.equal(sessions.get("p:chapter").anchor.offset, .7);
});

test("late source-view cleanup cannot overwrite a newly transferred destination snapshot", () => {
  const sessions = createReaderSessions();
  const previous = snapshot(22, .1);
  sessions.save("p:chapter", previous);
  sessions.save("p:reference:chapter", snapshot(22, .8));
  let notifications = 0;
  sessions.subscribe("p:chapter", () => notifications++);
  const copied = sessions.copy("p:reference:chapter", "p:chapter", { navigationKey: 4 });
  assert.equal(notifications, 1);
  assert.equal(sessions.save("p:chapter", previous), false);
  assert.equal(sessions.get("p:chapter").anchor.offset, .8);
  assert.equal(sessions.save("p:chapter", { ...copied, anchor: { page: 22, offset: .9 } }), true);
  assert.equal(notifications, 1, "ordinary scroll saves do not rerender a mounted reader");
});

test("transfers reset destination navigation metadata while later explicit navigation still wins", () => {
  const sessions = createReaderSessions();
  sessions.save("p:chapter", snapshot());
  const reference = sessions.copy("p:chapter", "p:reference:chapter");
  assert.equal(reference.navigationKey, undefined);
  assert.equal(reference.evidenceText, undefined);
  assert.equal(canRestoreReadingSession(reference, 22), true);
  assert.equal(canRestoreReadingSession(reference, 23), false);
  assert.equal(canRestoreReadingSession(reference, 22, 1), false);
  assert.equal(canRestoreReadingSession(reference, 22, undefined, "new citation"), false);
});

test("same-book pane swaps preserve independent passages and project-qualified state", () => {
  const sessions = createReaderSessions();
  sessions.save("p:chapter-a", snapshot(22, .25));
  sessions.save("p:reference:chapter-b", snapshot(55, .75));
  sessions.save("other:chapter-a", snapshot(99, .5));
  sessions.copy("p:chapter-a", "p:reference:chapter-a");
  sessions.copy("p:reference:chapter-b", "p:chapter-b", { navigationKey: 1 });
  assert.deepEqual(sessions.get("p:reference:chapter-a").anchor, { page: 22, offset: .25 });
  assert.deepEqual(sessions.get("p:chapter-b").anchor, { page: 55, offset: .75 });
  assert.deepEqual(sessions.get("other:chapter-a").anchor, { page: 99, offset: .5 });
  assert.equal(sessions.copy("missing", "p:chapter-a"), undefined);
  assert.equal(sessions.copy("p:chapter-a", "p:reference:chapter-a", { sourceId: "different-book" }), undefined);
  assert.equal(sessions.copy("p:chapter-a", "p:chapter-a"), undefined);
});

test("unmounted capture callbacks are removed without disturbing a replacement reader", () => {
  const sessions = createReaderSessions();
  const removeOld = sessions.register("p:chapter", () => snapshot(22));
  const removeNew = sessions.register("p:chapter", () => snapshot(23));
  removeOld();
  assert.equal(sessions.copy("p:chapter", "p:reference:chapter").anchor.page, 23);
  removeNew();
  assert.equal(sessions.copy("p:chapter", "p:reference:chapter").anchor.page, 23);
});

test("moving a main PDF into a fresh or previously navigated side view preserves its intra-page position", () => {
  for (const navigationKey of [0, 7]) {
    const sessions = createReaderSessions();
    sessions.save("p:chapter", snapshot(23, .65));
    sessions.save("p:reference:chapter", { ...snapshot(22, .1), navigationKey, evidenceText: "old side citation" });
    const copied = sessions.copy("p:chapter", "p:reference:chapter", {
      sourceId: "book", navigationKey,
    });
    assert.equal(canRestoreReadingSession(copied, 23, navigationKey), true);
    assert.equal(copied.evidenceText, undefined);
    assert.deepEqual(copied.anchor, { page: 23, offset: .65 });
    assert.equal(restoreReadingAnchor(copied.anchor, [{ page: 23, top: 20, height: 800 }], 600), 420);
  }
});

test("returning a same-identity floating PDF can replace an already mounted main reader's stale position", () => {
  const sessions = createReaderSessions();
  const oldMain = snapshot(69, .15);
  sessions.save("p:chapter", oldMain);
  sessions.register("p:chapter", () => oldMain);
  sessions.save("p:reference:chapter", snapshot(69, .15));
  sessions.register("p:reference:chapter", () => ({ ...snapshot(70, .8), zoom: 160 }));
  let changes = 0;
  sessions.subscribe("p:chapter", () => changes++);
  const copied = sessions.copy("p:reference:chapter", "p:chapter", { sourceId: "book", navigationKey: 5 });
  assert.equal(changes, 1);
  assert.equal(canRestoreReadingSession(copied, 70, 5), true);
  assert.deepEqual(copied.anchor, { page: 70, offset: .8 });
  assert.equal(copied.zoom, 160);
  assert.equal(sessions.save("p:chapter", oldMain), false);
  assert.deepEqual(sessions.get("p:chapter").anchor, { page: 70, offset: .8 });
});
