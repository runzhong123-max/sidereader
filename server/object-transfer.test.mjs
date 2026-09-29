import test from "node:test";
import assert from "node:assert/strict";
import { OBJECT_MIME, WORKSPACE_MIME, WORKSPACE_PAPER_MIME, WORKSPACE_OBJECT_MIME, WORKSPACE_CARD_MIME, readWorkspacePayload, readWorkspaceTransfer, writeWorkspaceTransfer, workspaceTransferKind, shouldPassWorkspaceTransfer, shouldPassFloatingTransfer, objectDropPosition, cardDockPosition } from "../src/object-transfer.mjs";
import { QUESTION_DROP_MIME } from "../src/question-references.mjs";

function transfer() {
  const data = new Map();
  return { data, setData: (type, value) => data.set(type, value), effectAllowed: "none" };
}

test("shelf objects transfer project-scoped identities without copying content", () => {
  const drag = transfer();
  writeWorkspaceTransfer(drag, "project-1", "paper:object-1", "二分查找小测");
  assert.equal(readWorkspaceTransfer(drag.data.get(OBJECT_MIME), "project-1"), "paper:object-1");
  assert.deepEqual(readWorkspacePayload(drag.data.get(OBJECT_MIME), "project-1"), { id: "paper:object-1", kind: "object" });
  assert.equal(readWorkspaceTransfer(drag.data.get(OBJECT_MIME), "project-2"), undefined);
  assert.deepEqual(Object.keys(JSON.parse(drag.data.get(OBJECT_MIME))).sort(), ["kind", "nodeId", "projectId", "transferKind", "version"]);
  assert.equal(drag.data.get(WORKSPACE_MIME), "1");
  assert.equal(drag.data.get(WORKSPACE_OBJECT_MIME), "1");
  assert.equal(drag.data.get("text/plain"), "二分查找小测");
  assert.equal(drag.effectAllowed, "copy");
});

test("paper, library object, and placed card intent is available without protected payload reads", () => {
  for (const [kind, mime] of [["paper", WORKSPACE_PAPER_MIME], ["object", WORKSPACE_OBJECT_MIME], ["card", WORKSPACE_CARD_MIME]]) {
    const drag = transfer();
    writeWorkspaceTransfer(drag, "p", "id", "标题", kind);
    assert.equal(workspaceTransferKind(drag.data.keys()), kind);
    assert.equal(drag.data.get(mime), "1");
    assert.equal(readWorkspacePayload(drag.data.get(OBJECT_MIME), "p").kind, kind);
  }
  assert.equal(workspaceTransferKind([OBJECT_MIME]), undefined);
  assert.equal(workspaceTransferKind([WORKSPACE_MIME]), "object");
  assert.equal(workspaceTransferKind([WORKSPACE_MIME, WORKSPACE_PAPER_MIME, WORKSPACE_CARD_MIME]), undefined);
});

test("legacy identities remain readable and malformed or cross-project payloads are rejected", () => {
  const input = { version: 1, projectId: "p", kind: "workspace", nodeId: "graph" };
  assert.equal(readWorkspaceTransfer(JSON.stringify(input), "p"), "graph");
  assert.deepEqual(readWorkspacePayload(JSON.stringify(input), "p"), { id: "graph", kind: "object" });
  for (const bad of [{ ...input, projectId: "other" }, { ...input, kind: "concept" }, { ...input, nodeId: "" }, { ...input, version: 2 }, { ...input, transferKind: "other" }, { ...input, transferKind: null }])
    assert.equal(readWorkspaceTransfer(JSON.stringify(bad), "p"), undefined);
  assert.equal(readWorkspaceTransfer("invalid", "p"), undefined);
  assert.equal(readWorkspaceTransfer("x".repeat(5000), "p"), undefined);
});

test("PDF, conversation and object drags have the same visible destinations", () => {
  for (const kind of ["paper", "card", "object"]) {
    assert.equal(objectDropPosition(10, 1000, kind), "left");
    assert.equal(objectDropPosition(990, 1000, kind), "right");
    assert.equal(objectDropPosition(500, 1000, kind), "main");
    assert.equal(objectDropPosition(0, 0, kind), "main");
    assert.equal(objectDropPosition(500, 1000, kind, true, 720, 800), "float");
    // Bottom corners remain the side destinations shown under the cursor.
    assert.equal(objectDropPosition(10, 1000, kind, true, 790, 800), "left");
    assert.equal(objectDropPosition(990, 1000, kind, true, 790, 800), "right");
  }
});

test("floating a native drag requires the explicit bottom destination", () => {
  assert.equal(objectDropPosition(500, 1000, "object", true, 687, 800), "main");
  assert.equal(objectDropPosition(500, 1000, "object", true, 688, 800), "float");
  assert.equal(objectDropPosition(500, 1000, "object", true, 800, 800), "float");
  assert.equal(objectDropPosition(500, 1000, "object", true, 801, 800), "main");
  // Short windows keep most of their center available for the main view.
  assert.equal(objectDropPosition(500, 1000, "object", true, 303, 400), "main");
  assert.equal(objectDropPosition(500, 1000, "object", true, 304, 400), "float");
  for (const [x, width] of [[NaN, 1000], [500, NaN], [-1, 1000], [1001, 1000], [0, 0]])
    assert.equal(objectDropPosition(x, width, "object", true, 790, 800), "main");
});

test("pointer-moving cards stays free except at explicit top-center and edge docking targets", () => {
  assert.equal(cardDockPosition(500, 32, 1000, 800), "main");
  assert.equal(cardDockPosition(500, 400, 1000, 800), null);
  assert.equal(cardDockPosition(150, 32, 1000, 800), null);
  assert.equal(cardDockPosition(15, 400, 1000, 800), "left");
  assert.equal(cardDockPosition(985, 400, 1000, 800), "right");
  assert.equal(cardDockPosition(64, 400, 1000, 800), "left");
  assert.equal(cardDockPosition(65, 400, 1000, 800), null);
  assert.equal(cardDockPosition(936, 400, 1000, 800), "right");
  assert.equal(cardDockPosition(935, 400, 1000, 800), null);
  assert.equal(cardDockPosition(500, 80, 1000, 800), "main");
  assert.equal(cardDockPosition(500, 81, 1000, 800), null);
  assert.equal(cardDockPosition(-10, 400, 1000, 800), null);
  assert.equal(cardDockPosition(15, 400, 400, 800), null);
  assert.equal(cardDockPosition(200, 32, 400, 800), "main");
  assert.equal(cardDockPosition(500, 32, NaN, 800), null);
});

test("a question transfer remains reachable by a floating conversation instead of falling through to layout", () => {
  const types = [WORKSPACE_MIME, WORKSPACE_OBJECT_MIME, QUESTION_DROP_MIME];
  assert.equal(shouldPassWorkspaceTransfer(types, true), false);
  assert.equal(shouldPassWorkspaceTransfer(types, false), true);
  assert.equal(shouldPassWorkspaceTransfer([WORKSPACE_MIME, WORKSPACE_CARD_MIME], true), true);
  assert.equal(shouldPassWorkspaceTransfer([QUESTION_DROP_MIME], true), false);
  assert.equal(shouldPassWorkspaceTransfer(["text/plain"], false), false);
});

test("reference-capable floating windows stay hittable even while a question is passing over PDF", () => {
  const types = [WORKSPACE_MIME, WORKSPACE_OBJECT_MIME, QUESTION_DROP_MIME];
  // The underlying PDF hit should allow workspace layout, but must not disable
  // a different floating window that will later receive the question.
  assert.equal(shouldPassWorkspaceTransfer(types,false),true);
  assert.equal(shouldPassFloatingTransfer(types,true),false);
  assert.equal(shouldPassFloatingTransfer(types,false),true);
  // Pure workspace placement can still pass through a conversation window.
  assert.equal(shouldPassFloatingTransfer([WORKSPACE_MIME,WORKSPACE_CARD_MIME],true),true);
});

test("narrow workspaces never promise a side-by-side drop they cannot show", () => {
  for (const width of [390, 480, 760, 840]) {
    assert.equal(objectDropPosition(1, width, "paper"), "main");
    assert.equal(objectDropPosition(width - 1, width, "card"), "main");
    assert.equal(objectDropPosition(1, width, "object"), "main");
    assert.equal(objectDropPosition(1, width, "object", false, 790, 800), "float");
    assert.equal(cardDockPosition(1, 400, width, 800), null);
    assert.equal(cardDockPosition(width - 1, 400, width, 800), null);
    assert.equal(cardDockPosition(width / 2, 32, width, 800), "main");
  }
  assert.equal(objectDropPosition(1, 852, "paper"), "left");
  assert.equal(cardDockPosition(851, 400, 852, 800), "right");
});
