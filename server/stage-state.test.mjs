import test from "node:test";
import assert from "node:assert/strict";
import {
  removeStage,
  restoreRemovedStage,
  prerequisiteWouldCycle,
} from "../src/stage-state.mjs";
const fixture = () => ({
  stages: [
    { id: "a", title: "A", done: true },
    { id: "b", title: "B", prerequisites: ["a"] },
    { id: "c", title: "C", prerequisites: ["b"] },
  ],
});
test("removing a stage clears incoming prerequisites and persistent undo restores order and completion", () => {
  const p = fixture();
  const removed = removeStage(p, "a");
  assert.deepEqual(removed.stages[0].prerequisites, []);
  const restored = restoreRemovedStage(JSON.parse(JSON.stringify(removed)));
  assert.equal(restored.stages[0].id, "a");
  assert.equal(restored.stages[0].done, true);
  assert.deepEqual(restored.stages[1].prerequisites, ["a"]);
  assert.equal(restored.stageRemoval, undefined);
  assert.equal(p.stages.length, 3);
});
test("undo preserves later prerequisite edits and does not recreate deleted dependencies", () => {
  const removed = removeStage(fixture(), "b");
  const changed = {
    ...removed,
    stages: removed.stages
      .filter((s) => s.id !== "a")
      .map((s) => ({ ...s, prerequisites: ["new"] })),
  };
  const restored = restoreRemovedStage(changed);
  assert.deepEqual(restored.stages.find((s) => s.id === "b").prerequisites, []);
  assert.deepEqual(restored.stages.find((s) => s.id === "c").prerequisites, [
    "new",
  ]);
});
test("prerequisite checks reject self and indirect cycles", () => {
  assert.equal(prerequisiteWouldCycle(fixture().stages, "a", "c"), true);
  assert.equal(prerequisiteWouldCycle(fixture().stages, "a", "a"), true);
  assert.equal(prerequisiteWouldCycle(fixture().stages, "c", "a"), false);
});
test("undo does not add a dependency that would create a cycle after later changes", () => {
  const removed = removeStage(fixture(), "a");
  const changed = {
    ...removed,
    stages: [
      { id: "a", title: "Later A", prerequisites: ["b"] },
      ...removed.stages,
    ],
  };
  const restored = restoreRemovedStage(changed);
  assert.deepEqual(restored.stages.find((s) => s.id === "b").prerequisites, []);
  assert.equal(restored.stages.filter((s) => s.id === "a").length, 1);
});
