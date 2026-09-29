import test from "node:test";
import assert from "node:assert/strict";
import { createPreferences } from "../src/persistence/preferences.mjs";
import { persistenceKeys, persistenceVersions } from "../src/persistence/keys.mjs";

const memoryStorage = (entries = []) => {
  const data = new Map(entries);
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
};

test("unified keys retain durable project, PDF, preference and draft addresses", () => {
  assert.equal(persistenceVersions.projects, 2);
  assert.equal(persistenceKeys.projects, "sidereader:projects:v2");
  assert.equal(persistenceKeys.workspace, "sidereader:workspace:v1");
  assert.equal(persistenceKeys.pdf("book"), "sidereader:pdf:book");
  const storage = memoryStorage([
    ["sidereader:tree-collapsed:v1", "true"],
    ["sidereader:paper-tree-expansion:v2", '{"project":{"chapter":true}}'],
    ["sidereader:split-ratio:v1", "0.38"],
    ["sidereader:draft:project:chat", "未发送的文字"],
    ["sidereader:concept-draft:project:chat", '["concept"]'],
  ]);
  const prefs = createPreferences(storage);
  assert.equal(prefs.getJSON(persistenceKeys.treeCollapsed, false), true);
  assert.deepEqual(prefs.getJSON(persistenceKeys.treeExpansion, {}), { project: { chapter: true } });
  assert.equal(prefs.getJSON(persistenceKeys.splitRatio, .5), .38);
  assert.equal(prefs.getText(persistenceKeys.draft("project:chat")), "未发送的文字");
  assert.deepEqual(prefs.getJSON(persistenceKeys.conceptDraft("project:chat"), []), ["concept"]);
});

test("optional storage preserves malformed records and tolerates unavailable storage", () => {
  const storage = memoryStorage([["invalid", "{broken"], ["wrong-type", '"string"']]);
  const prefs = createPreferences(storage);
  assert.deepEqual(prefs.getJSON("invalid", {}), {});
  assert.equal(storage.data.get("invalid"), "{broken");
  assert.equal(prefs.getJSON("wrong-type", false, (v) => typeof v === "boolean"), false);
  const blocked = createPreferences({ getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } });
  assert.equal(blocked.getText("draft", "fallback"), "fallback");
  assert.equal(blocked.setJSON("draft", {}), false);
  assert.equal(blocked.remove("draft"), false);
  assert.equal(createPreferences().setText("draft", "value"), false);
});

test("draft removal and JSON writes touch only the addressed key", () => {
  const storage = memoryStorage([["other", "retained"]]);
  const prefs = createPreferences(storage);
  assert.equal(prefs.setText("draft", "原文"), true);
  assert.equal(prefs.setJSON("selection", ["a"]), true);
  assert.equal(prefs.remove("draft"), true);
  assert.equal(storage.data.has("draft"), false);
  assert.equal(storage.data.get("other"), "retained");
  assert.deepEqual(prefs.getJSON("selection", []), ["a"]);
  const circular = {}; circular.self = circular;
  assert.equal(prefs.setJSON("other", circular), false);
  assert.equal(storage.data.get("other"), "retained");
});
