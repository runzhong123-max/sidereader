import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as graphState from "../src/auto-graph-state.mjs";
import { ensureScopeGraph, normalizePaperTree, scopeGraphId } from "../src/paper-tree-state.mjs";

const sourceText = readFileSync(new URL("../src/use-automatic-graph.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(sourceText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const equalDeps = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

// Run the actual hook with controlled React commits, API promises and browser timers.
// This exercises lifecycle ordering without making model requests or relying on wall time.
function harness(initial, ids) {
  const projects = new Map(initial.map((project) => [project.id, project]));
  let currentId = initial[0].id, activeIds = ids, enabled = true;
  let cursor = 0, dirty = true, now = 0, nextTimer = 0, current, effects = [];
  const slots = [], timers = new Map(), calls = [];
  const window = {
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { time: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const React = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(value) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof value === "function" ? value() : value };
      return [slots[index].value, (change) => { const next = typeof change === "function" ? change(slots[index].value) : change; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }];
    },
    useCallback(callback, deps) { const index = cursor++; if (!slots[index] || !equalDeps(slots[index].deps, deps)) slots[index] = { value: callback, deps }; return slots[index].value; },
    useEffect(effect, deps) {
      const index = cursor++;
      if (slots[index] && equalDeps(slots[index].deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps, cleanup: undefined };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
    },
  };
  const api = (path, payload, signal) => new Promise((resolve, reject) => {
    calls.push({ path, payload, signal, resolve, reject });
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const exports = {};
  new Function("require", "exports", "window", compiled)((name) => {
    if (name === "react") return React;
    if (name === "./services/http") return { api };
    if (name === "./auto-graph-state.mjs") return graphState;
    throw new Error(`Unexpected import ${name}`);
  }, exports, window);
  const updateProject = (id, change) => { projects.set(id, change(projects.get(id))); dirty = true; };
  function render() {
    for (let count = 0; dirty; count++) {
      assert.ok(count < 30, "hook commit must settle");
      dirty = false; cursor = 0; effects = [];
      current = exports.useAutomaticGraph(projects.get(currentId), activeIds, enabled, updateProject);
      for (const effect of effects) effect();
    }
    return current;
  }
  function tick(ms) {
    const until = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.time <= until).sort((a, b) => a[1].time - b[1].time)[0];
      if (!next) break;
      now = next[1].time; timers.delete(next[0]); next[1].fn(); render();
    }
    now = until;
    return render();
  }
  async function settle() { for (let count = 0; count < 8; count++) { await Promise.resolve(); render(); } }
  async function resolve(index, label = `概念${index}`) {
    calls[index].resolve({ concepts: [{ id: label, name: label, description: "定义", links: [], group: 0, x: 0, y: 0 }], sampledPages: 2, totalPages: 2, sampledChunks: 2, totalChunks: 2, truncated: false });
    await settle();
  }
  render();
  return { calls, projects, tick, settle, resolve, get value() { return render(); },
    set({ projectId = currentId, ids = activeIds, run = enabled } = {}) { currentId = projectId; activeIds = ids; enabled = run; dirty = true; return render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function fixture(id = "p") {
  let project = normalizePaperTree({
    id, name: `项目${id}`, goal: "学习", version: 1, concepts: [], stages: [], sets: [],
    sources: [{ id: "s", title: "教材", kind: "pdf", pages: ["甲", "乙", "丙", "丁"], progress: 1,
      chunks: [1, 2, 3, 4].map((page) => ({ id: `chunk-${page}`, sourceId: "s", title: "教材", page, text: `第${page}页` })),
      outline: [{ title: "第一章", page: 1, endPage: 2, level: 1, kind: "chapter" }, { title: "第二章", page: 3, endPage: 4, level: 1, kind: "chapter" }] }],
    chats: [{ id: "tutor", title: "项目 tutor", messages: [] }], tabs: [{ id: "tutor", kind: "chat" }], activeTab: "tutor", activeSource: "s", page: 1,
  });
  for (const node of project.paperTree.nodes.filter((node) => node.role === "chapter")) project = ensureScopeGraph(project, node.id);
  return project;
}
const chapters = (project) => project.paperTree.nodes.filter((node) => node.role === "chapter").map((node) => scopeGraphId(node.id));
const status = (project, id) => project.paperTree.nodes.find((node) => node.id === id)?.autoGraph?.status;

test("visible scopes are deduplicated and generated serially across layout changes", async () => {
  const p = fixture(), [first, second] = chapters(p);
  const h = harness([p], ["tutor", "graph", first, second, first]);
  assert.deepEqual(h.value.plans.map((plan) => plan.graphId), ["graph", first, second]);
  h.tick(650);
  assert.equal(h.calls.length, 1);
  assert.equal(h.value.runningGraphId, "graph");
  h.set({ ids: [second, "graph", first] }); h.tick(1000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].signal.aborted, false);
  await h.resolve(0);
  h.tick(650);
  assert.equal(h.calls.length, 2);
  assert.equal(h.value.runningGraphId, second);
  // Closing a floating view keeps its running extraction, but cannot create hidden work.
  h.set({ ids: [first] });
  await h.resolve(1); h.tick(650);
  assert.equal(h.calls.length, 3);
  assert.equal(h.value.runningGraphId, first);
  await h.resolve(2); h.tick(3000);
  assert.equal(h.calls.length, 3);
  for (const id of ["graph", first, second]) assert.equal(status(h.projects.get("p"), id), "ready");
  assert.equal(h.value.busy, false);
  h.unmount();
});

test("failed graphs wait for explicit targeted retry and retry can queue behind another graph", async () => {
  const p = fixture(), [first] = chapters(p);
  const h = harness([p], ["graph", first]);
  h.tick(650); h.calls[0].reject(new Error("暂时失败")); await h.settle();
  assert.equal(status(h.projects.get("p"), "graph"), "error");
  h.tick(650);
  assert.equal(h.value.runningGraphId, first);
  h.value.retry("graph"); h.tick(650);
  assert.equal(h.calls.length, 2);
  // Retrying an already-running graph must not enqueue a duplicate.
  h.value.retry(first);
  await h.resolve(1); h.tick(650);
  assert.equal(h.value.runningGraphId, "graph");
  await h.resolve(2); h.tick(3000);
  assert.equal(h.calls.length, 3);
  assert.equal(status(h.projects.get("p"), "graph"), "ready");
  h.value.retry("absent"); h.tick(650);
  assert.equal(h.calls.length, 3);
  h.unmount();
});

test("project switches never retarget an in-flight result or create parallel requests", async () => {
  const p = fixture("p"), other = fixture("other");
  const h = harness([p, other], "graph");
  h.tick(650);
  h.set({ projectId: "other", ids: ["graph"] }); h.tick(650);
  assert.equal(h.value.runningGraphId, undefined);
  assert.equal(h.calls.length, 1);
  await h.resolve(0, "只属于旧项目");
  assert.equal(status(h.projects.get("p"), "graph"), "ready");
  assert.equal(h.projects.get("other").concepts.length, 0);
  h.tick(650); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].payload.scope.title, "项目other");
  await h.resolve(1, "只属于新项目");
  assert.equal(h.projects.get("p").concepts[0].name, "只属于旧项目");
  assert.equal(h.projects.get("other").concepts[0].name, "只属于新项目");
  h.unmount();
});

test("hidden or disabled pending views do not generate and unmount cancels active extraction", async () => {
  const h = harness([fixture()], ["graph"]);
  h.set({ ids: [] }); h.tick(1000); assert.equal(h.calls.length, 0);
  h.set({ ids: ["graph"], run: false }); h.tick(1000); assert.equal(h.calls.length, 0);
  h.set({ run: true }); h.tick(650); assert.equal(h.calls.length, 1);
  h.unmount(); await h.settle();
  assert.equal(h.calls[0].signal.aborted, true);
});
