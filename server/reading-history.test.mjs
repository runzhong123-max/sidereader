import test from "node:test";
import assert from "node:assert/strict";
import { createReadingHistory } from "../src/reading-history.mjs";
import { createReaderSessions } from "../src/reader-sessions.mjs";
import { canRestoreReadingSession } from "../src/reader-viewport.mjs";

const visit = (page, offset = .45) => ({
  main: { id: "chapter:linear", kind: "book", sourceId: "pdf" },
  companionId: "chat:linear", comparisonOpen: true, side: "right", expanded: false,
  readers: [{ key: "p:chapter:linear", target: { id: "chapter:linear", sourceId: "pdf" }, comparison: false, page,
    session: { sourceId: "pdf", anchor: { page, offset }, zoom: 140, textMode: false } }],
  evidenceText: "", referenceAnchors: {},
});

test("nested citation visits return in order with their original passage and layout", () => {
  const history = createReadingHistory();
  const first = visit(69, .6);
  history.push("p", first);
  first.readers[0].session.anchor.offset = .1;
  history.push("p", { ...visit(41), side: "left", expanded: true });
  const latest = history.peek("p");
  latest.readers[0].page = 1;
  assert.equal(history.take("p").readers[0].page, 41);
  const previous = history.take("p");
  assert.deepEqual(previous.readers[0].session.anchor, { page: 69, offset: .6 });
  assert.equal(previous.side, "right");
  assert.equal(previous.companionId, "chat:linear");
  assert.equal(history.peek("p"), undefined);
});

test("history is bounded and project scoped, and skips removed sources", () => {
  const history = createReadingHistory(2);
  for (const page of [1, 2, 3]) history.push("p", visit(page));
  history.push("other", visit(88));
  assert.equal(history.take("p", (entry) => entry.readers[0].page !== 3).readers[0].page, 2);
  assert.equal(history.take("p"), undefined);
  assert.equal(history.take("other").readers[0].page, 88);
});

test("returning from a same-page citation restores the captured line and zoom instead of the citation position", () => {
  const sessions = createReaderSessions();
  const key = "p:chapter:linear";
  let live = { sourceId: "pdf", anchor: { page: 69, offset: .65 }, zoom: 150, textMode: true, navigationKey: 1 };
  sessions.register(key, () => live);
  const before = sessions.capture(key);
  live = { ...live, anchor: { page: 69, offset: .2 }, zoom: 100, evidenceText: "citation", navigationKey: 2 };
  sessions.save(key, live);
  const restored = sessions.restore(key, before, { sourceId: "pdf", navigationKey: 3, evidenceText: "" });
  assert.deepEqual(restored.anchor, { page: 69, offset: .65 });
  assert.equal(restored.zoom, 150);
  assert.equal(restored.textMode, true);
  assert.equal(canRestoreReadingSession(restored, 69, 3, ""), true);
  assert.equal(sessions.save(key, live), false, "late citation cleanup cannot replace the restored passage");
  assert.equal(sessions.restore(key, before, { sourceId: "different" }), undefined);
});

test("a side PDF visit restores its own session without moving the main PDF", () => {
  const sessions = createReaderSessions();
  const original = visit(41, .7).readers[0].session;
  sessions.save("p:main", visit(69, .3).readers[0].session);
  sessions.save("p:reference:chapter", original);
  const saved = sessions.capture("p:reference:chapter");
  sessions.save("p:reference:chapter", visit(55, .1).readers[0].session);
  sessions.restore("p:reference:chapter", saved, { navigationKey: 2 });
  assert.deepEqual(sessions.get("p:reference:chapter").anchor, { page: 41, offset: .7 });
  assert.deepEqual(sessions.get("p:main").anchor, { page: 69, offset: .3 });
});
