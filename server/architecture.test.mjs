import test from "node:test";
import assert from "node:assert/strict";
import { inspectModule } from "../scripts/check-architecture.mjs";
const dependencies = new Set(["react", "idb-keyval", "d3-force"]);

test("domain includes compatibility modules but rejects UI and I/O dependencies", () => {
  assert.deepEqual(inspectModule("src/domain/model.mjs", 'import { relation } from "../paper-state.mjs";', dependencies), []);
  assert.deepEqual(inspectModule("src/graph-layout.mjs", 'import { forceSimulation } from "d3-force";', dependencies), []);
  assert.match(inspectModule("src/domain/model.mjs", 'import { useState } from "react";', dependencies).join("\n"), /pure domain/);
  assert.match(inspectModule("src/paper-state.mjs", 'import UI from "./components/Tutor";', dependencies).join("\n"), /pure domain/);
  assert.match(inspectModule("src/domain/model.mjs", 'import { localPreferences } from "../persistence/preferences.mjs";', dependencies).join("\n"), /pure domain/);
});

test("storage and network access stay at explicit infrastructure boundaries", () => {
  assert.match(inspectModule("src/components/Example.tsx", 'localStorage.setItem("key", "value"); fetch("/api");', dependencies).join("\n"), /src\/persistence/);
  assert.match(inspectModule("src/components/Example.tsx", 'import { api } from "../storage";', dependencies).join("\n"), /explicitly/);
  assert.deepEqual(inspectModule("src/persistence/preferences.mjs", 'globalThis.localStorage;', dependencies), []);
  assert.deepEqual(inspectModule("src/services/http.ts", 'fetch("/api");', dependencies), []);
  assert.match(inspectModule("src/persistence/repository.ts", 'import { api } from "../services/http";', dependencies).join("\n"), /persistence must not/);
});

test("server accepts shared pure rules and rejects a browser runtime", () => {
  assert.deepEqual(inspectModule("server/rules.mjs", 'import { model } from "../src/domain/model.mjs";', dependencies), []);
  assert.match(inspectModule("server/rules.mjs", 'import { tutorSessions } from "../src/tutor-sessions.mjs";', dependencies).join("\n"), /browser runtime/);
  assert.match(inspectModule("server/test.mjs", 'import { build } from "esbuild";', dependencies).join("\n"), /undeclared direct dependency/);
});
