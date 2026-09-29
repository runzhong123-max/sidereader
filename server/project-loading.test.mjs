import test from "node:test";
import assert from "node:assert/strict";
import { loadInitialProjects } from "../src/project-loading.mjs";
const seed = () => ({
  version: 1,
  id: "seed",
  name: "Seed",
  sources: [],
  concepts: [],
  stages: [],
  sets: [],
  chats: [],
  tabs: [{ id: "chat", kind: "chat" }],
  activeTab: "chat",
});
const options = (overrides = {}) => ({
  loadProjects: async () => undefined,
  loadWorkspace: async () => undefined,
  bootstrap: async () => null,
  seed,
  ...overrides,
});
test("read failure never falls through to bootstrap or an empty writable project", async () => {
  let bootstrapped = false;
  await assert.rejects(
    loadInitialProjects(
      options({
        loadProjects: async () => {
          throw Error("storage blocked");
        },
        bootstrap: async () => {
          bootstrapped = true;
        },
      }),
    ),
    /storage blocked/,
  );
  assert.equal(bootstrapped, false);
});
test("unknown saved schema is preserved by failing the load", async () => {
  await assert.rejects(
    loadInitialProjects(
      options({ loadProjects: async () => ({ version: 3, projects: [] }) }),
    ),
    /格式无法识别/,
  );
});
test("legacy user workspace wins over demo bootstrap and retains objects", async () => {
  const legacy = {
    ...seed(),
    id: undefined,
    name: "My book",
    stages: [{ id: "kept" }],
  };
  delete legacy.id;
  let bootstrapped = false;
  const store = await loadInitialProjects(
    options({
      loadWorkspace: async () => legacy,
      bootstrap: async () => {
        bootstrapped = true;
        return { version: 2, projects: [seed()] };
      },
    }),
  );
  assert.equal(store.projects[0].name, "My book");
  assert.deepEqual(store.projects[0].stages, [{ id: "kept" }]);
  assert.equal(bootstrapped, false);
  assert.equal(store.activeProjectId, "seed");
});
test("existing projects bypass migration; only an empty store receives defaults", async () => {
  const saved = {
    version: 2,
    projects: [{ ...seed(), name: "Saved" }],
    activeProjectId: "seed",
  };
  assert.equal(
    await loadInitialProjects(
      options({
        loadProjects: async () => saved,
        loadWorkspace: async () => {
          throw Error("should not run");
        },
      }),
    ),
    saved,
  );
  const store = await loadInitialProjects(
    options({
      bootstrap: async () => {
        throw Error("offline");
      },
    }),
  );
  assert.equal(store.projects[0].name, "Seed");
});
