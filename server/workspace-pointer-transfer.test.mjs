import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspacePointerTransfer, workspacePointerPosition } from "../src/workspace-pointer-transfer.mjs";

const identity = { projectId: "project", nodeId: "scope-graph:chapter", kind: "object" };
const rect = { left: 280, top: 60, width: 1000, height: 800 };
const point = (x, y, pointerId = 1) => ({ x, y, pointerId });

test("ordinary sidebar clicks and small pointer jitter never place content", () => {
  const events = [];
  const drag = createWorkspacePointerTransfer(identity, point(90, 250), (event) => events.push(event));
  assert.equal(drag.move(point(93, 254)), false);
  assert.equal(drag.finish(point(93, 254)), false);
  assert.deepEqual(events, []);
});

test("sidebar pointer drags share main, left, right and float destinations with native transfers", () => {
  for (const kind of ["paper", "object", "card"]) {
    for (const [x, y, expected] of [[780, 350, "main"], [300, 350, "left"], [1260, 350, "right"], [780, 825, "float"]]) {
      const previews = [], placements = [];
      const drag = createWorkspacePointerTransfer({ ...identity, kind }, point(90, 250), (event) => {
        const position = workspacePointerPosition(event, "project", rect);
        if (event.phase === "move") previews.push(position);
        if (event.phase === "drop" && position) placements.push({ id: event.nodeId, position });
      });
      assert.equal(drag.move(point(x, y)), true);
      assert.equal(drag.finish(point(x, y)), true, "a completed drag suppresses the following row click");
      assert.deepEqual(previews, [expected]);
      assert.deepEqual(placements, [{ id: identity.nodeId, position: expected }]);
      assert.equal(drag.cancel(), false, "lost capture after release cannot undo or repeat a drop");
      assert.equal(drag.finish(point(x, y)), undefined);
      assert.equal(placements.length, 1);
    }
  }
});

test("the final pointer location wins even if the last move was coalesced", () => {
  const events = [], drag = createWorkspacePointerTransfer(identity, point(90, 250), (event) => events.push(event));
  drag.move(point(780, 350));
  drag.finish(point(1260, 350));
  assert.equal(workspacePointerPosition(events.at(-1), "project", rect), "right");
  const releaseOnly = createWorkspacePointerTransfer(identity, point(90, 250), (event) => events.push(event));
  assert.equal(releaseOnly.finish(point(780, 825)), true);
  assert.equal(workspacePointerPosition(events.at(-1), "project", rect), "float");
});

test("Escape, lost capture, window blur and unmount share cancellation without a placement", () => {
  const events = [], drag = createWorkspacePointerTransfer(identity, point(90, 250), (event) => events.push(event));
  drag.move(point(780, 350));
  assert.equal(drag.cancel(), true);
  assert.equal(workspacePointerPosition(events.at(-1), "project", rect), undefined);
  assert.equal(drag.finish(point(780, 350)), undefined);
  assert.deepEqual(events.map((event) => event.phase), ["move", "cancel"]);
});

test("leaving the workspace clears preview and releasing outside does not mutate its layout", () => {
  const events = [], drag = createWorkspacePointerTransfer(identity, point(90, 250), (event) => events.push(event));
  drag.move(point(780, 350));
  drag.move(point(90, 250));
  drag.finish(point(90, 250));
  assert.deepEqual(events.map((event) => workspacePointerPosition(event, "project", rect)), ["main", undefined, undefined]);
});

test("foreign projects, invalid points and unrelated pointers cannot place content", () => {
  const events = [], drag = createWorkspacePointerTransfer(identity, point(90, 250), (event) => events.push(event));
  assert.equal(drag.move(point(780, 350, 2)), false);
  assert.equal(drag.finish(point(780, 350, 2)), undefined);
  assert.deepEqual(events, []);
  drag.move(point(780, 350));
  assert.equal(workspacePointerPosition(events[0], "other-project", rect), undefined);
  for (const change of [{ x: NaN }, { y: Infinity }, { kind: "concept" }, { nodeId: "" }])
    assert.equal(workspacePointerPosition({ ...events[0], ...change }, "project", rect), undefined);
  assert.equal(createWorkspacePointerTransfer({ ...identity, kind: "concept" }, point(90, 250), () => {}), undefined);
});

test("narrow pointer drops show only main and floating destinations", () => {
  const update = { ...identity, phase: "move", x: 290, y: 200 };
  assert.equal(workspacePointerPosition(update, "project", { ...rect, width: 500 }), "main");
  assert.equal(workspacePointerPosition({ ...update, y: 825 }, "project", { ...rect, width: 500 }), "float");
});
