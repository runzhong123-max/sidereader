import test from "node:test";
import assert from "node:assert/strict";
import { navigateFloatingContent, placeWorkspaceContent, revealWorkspaceContent, workspaceContentLocation, validWorkspaceViews, workspaceContent } from "../src/workspace-placement.mjs";

const reading = () => ({
  mainId: "chapter:linear-models", companionId: "chat:linear-models",
  comparisonOpen: true, side: "right", floatingIds: ["graph:chapter"],
});

test("ordinary object preview preserves PDF and conversation, then reveals its existing placement", () => {
  const initial = {...reading(),floatingIds:[]};
  const preview = revealWorkspaceContent(initial,"questions:practice","float");
  assert.equal(preview.mainId,initial.mainId);
  assert.equal(preview.companionId,initial.companionId);
  assert.equal(preview.comparisonOpen,true);
  assert.deepEqual(preview.floatingIds,["questions:practice"]);
  assert.deepEqual(revealWorkspaceContent(preview,"questions:practice","float"),preview);
  const docked = placeWorkspaceContent(preview,"questions:practice","left");
  assert.equal(workspaceContentLocation(docked,"questions:practice"),"left");
  assert.deepEqual(revealWorkspaceContent(docked,"questions:practice","float"),docked);
});

test("PDF follow-up and object references reuse a floating conversation without a second input", () => {
  const detached = placeWorkspaceContent(reading(),"chat:linear-models","float");
  for (const preferred of ["right","left"]) {
    const opened = revealWorkspaceContent(detached,"chat:linear-models",preferred);
    assert.equal(opened.comparisonOpen,false);
    assert.equal(opened.mainId,"chapter:linear-models");
    assert.equal(workspaceContentLocation(opened,"chat:linear-models"),"float");
    assert.equal(opened.floatingIds.filter((id)=>id==="chat:linear-models").length,1);
  }
});

test("revealing an already visible conversation preserves the chosen left placement", () => {
  const left = {...reading(),side:"left"};
  assert.deepEqual(revealWorkspaceContent(left,left.companionId,"right"),left);
});

test("revealing hidden main content in single-pane mode really reveals it", () => {
  const singlePane = { ...reading(), mainId:"chat:linear-models", companionId:"chapter:linear-models" };
  const shown = revealWorkspaceContent(singlePane,singlePane.mainId,"right",true);
  assert.equal(shown.comparisonOpen,false);
  assert.equal(shown.mainId,"chat:linear-models");
  assert.equal(shown.companionId,"chapter:linear-models");
});

test("a floating generated object's origin reveals its main conversation hidden by narrow layout", () => {
  const singlePane = { ...reading(), mainId:"chat:linear-models", companionId:"chapter:linear-models" };
  const returned = navigateFloatingContent(singlePane,"graph:chapter","chat:linear-models",true);
  assert.equal(returned.comparisonOpen,false);
  assert.equal(returned.mainId,"chat:linear-models");
  assert.deepEqual(returned.floatingIds,[]);
  assert.equal(navigateFloatingContent(singlePane,"graph:chapter","chat:linear-models",false).comparisonOpen,true);
});

test("reveal repairs duplicate legacy instances and preserves unrelated windows", () => {
  const duplicated = {...reading(),floatingIds:["graph:chapter","chat:linear-models","chat:linear-models"]};
  assert.deepEqual(revealWorkspaceContent(duplicated,"chat:linear-models","float"),reading());
});

test("returning from a floating object reuses a visible conversation and removes only the source window", () => {
  const current = {...reading(),floatingIds:["graph:chapter","questions:practice"]};
  const next = navigateFloatingContent(current,"graph:chapter",current.companionId);
  assert.deepEqual(next,{...current,floatingIds:["questions:practice"]});
  assert.deepEqual(current.floatingIds,["graph:chapter","questions:practice"]);
});

test("floating origin navigation replaces its window or focuses the existing destination", () => {
  const current = {...reading(),comparisonOpen:false};
  const next = navigateFloatingContent(current,"graph:chapter",current.companionId);
  assert.deepEqual(next,{...current,floatingIds:[current.companionId]});
  const existing = {...current,floatingIds:["graph:chapter",current.companionId]};
  assert.deepEqual(navigateFloatingContent(existing,"graph:chapter",current.companionId),next);
  assert.deepEqual(navigateFloatingContent(current,"graph:chapter",current.mainId),{...current,floatingIds:[]});
});

test("PDFs, conversations, graphs and exercises all support the same spatial placement", () => {
  for (const kind of ["book", "chat", "graph", "questions"])
    assert.equal(workspaceContent(kind)?.canFloat, true, `${kind} can be a floating visual`);
  assert.equal(workspaceContent("unknown"), undefined);
});

test("promoting a side conversation preserves the PDF by swapping the two panes", () => {
  const current = reading(), before = structuredClone(current);
  const next = placeWorkspaceContent(current, "chat:linear-models", "main");
  assert.deepEqual(next, {
    ...current, mainId: "chat:linear-models", companionId: "chapter:linear-models",
  });
  assert.deepEqual(current, before);
  assert.notStrictEqual(next.floatingIds, current.floatingIds);
});

test("dragging main content to a side keeps the old companion as the new main", () => {
  for (const side of ["left", "right"]) {
    const current = reading();
    const next = placeWorkspaceContent(current, current.mainId, side);
    assert.equal(next.mainId, current.companionId);
    assert.equal(next.companionId, current.mainId);
    assert.equal(next.side, side);
    assert.equal(next.comparisonOpen, true);
    assert.deepEqual(next.floatingIds, current.floatingIds);
  }
});

test("opening a third visual as main retains the user's existing side reference", () => {
  for (const target of ["graph:chapter", "questions:practice", "chat:branch"]) {
    const current = reading();
    const next = placeWorkspaceContent(current, target, "main");
    assert.equal(next.mainId, target);
    assert.equal(next.companionId, current.companionId);
    assert.equal(next.comparisonOpen, true);
    assert.equal(next.side, current.side);
    assert.ok(!next.floatingIds.includes(target));
  }
});

test("dropping content onto its existing place never duplicates or clears a pane", () => {
  const current = reading();
  assert.deepEqual(placeWorkspaceContent(current, current.mainId, "main"), current);
  assert.deepEqual(placeWorkspaceContent(current, current.companionId, "right"), current);

  const single = { ...current, comparisonOpen: false, floatingIds: [] };
  for (const side of ["left", "right"])
    assert.deepEqual(placeWorkspaceContent(single, single.mainId, side), single);

  const noCompanion = { mainId: "book:source", comparisonOpen: false, side: "right", floatingIds: [] };
  assert.deepEqual(placeWorkspaceContent(noCompanion, noCompanion.mainId, "left"), noCompanion);
});

test("replacing a single main visual does not resurrect a previously closed companion", () => {
  const current = { ...reading(), comparisonOpen: false };
  const next = placeWorkspaceContent(current, "questions:practice", "main");
  assert.equal(next.mainId, "questions:practice");
  assert.equal(next.companionId, current.companionId);
  assert.equal(next.comparisonOpen, false);
});

test("an object has one floating window and docking removes that window without altering the others", () => {
  const current = reading();
  const once = placeWorkspaceContent(current, "questions:practice", "float");
  const twice = placeWorkspaceContent(once, "questions:practice", "float");
  assert.deepEqual(twice.floatingIds, ["graph:chapter", "questions:practice"]);
  assert.equal(twice.mainId, current.mainId);
  assert.equal(twice.companionId, current.companionId);
  for (const position of ["main", "left", "right"]) {
    const docked = placeWorkspaceContent(twice, "questions:practice", position);
    assert.deepEqual(docked.floatingIds, ["graph:chapter"]);
    assert.equal(position === "main" ? docked.mainId : docked.companionId, "questions:practice");
  }
  assert.deepEqual(current, reading());
});

test("detaching the side content moves it out of the split rather than copying it", () => {
  for (const side of ["left", "right"]) {
    const current = { ...reading(), side };
    const next = placeWorkspaceContent(current, current.companionId, "float");
    assert.equal(next.mainId, current.mainId);
    assert.equal(next.comparisonOpen, false);
    assert.deepEqual(next.floatingIds, ["graph:chapter", current.companionId]);
    const repeated = placeWorkspaceContent(next, current.companionId, "float");
    assert.deepEqual(repeated, next);
    const docked = placeWorkspaceContent(next, current.companionId, side);
    assert.deepEqual(docked, current);
  }
});

test("detaching the main content promotes the visible companion and closes the split", () => {
  const current = reading();
  const next = placeWorkspaceContent(current, current.mainId, "float", "book:fallback");
  assert.equal(next.mainId, current.companionId);
  assert.equal(next.comparisonOpen, false);
  assert.deepEqual(next.floatingIds, ["graph:chapter", current.mainId]);
  assert.deepEqual(placeWorkspaceContent(next, current.mainId, "float"), next);
  assert.deepEqual(current, reading());
});

test("detaching a sole main view uses its fallback without resurrecting a closed conversation", () => {
  const current = { ...reading(), mainId: "graph:chapter", comparisonOpen: false, floatingIds: ["book:source", "questions:practice"] };
  const next = placeWorkspaceContent(current, current.mainId, "float", "book:source");
  assert.equal(next.mainId, "book:source");
  assert.equal(next.comparisonOpen, false);
  // The fallback moves out of its old floating position as the graph detaches.
  assert.deepEqual(next.floatingIds, ["questions:practice", "graph:chapter"]);
  assert.deepEqual(current.floatingIds, ["book:source", "questions:practice"]);
});

test("the only main view stays in place when no distinct fallback is available", () => {
  const current = { mainId: "book:source", comparisonOpen: false, side: "right", floatingIds: [] };
  for (const fallback of [undefined, "", current.mainId, null, 12])
    assert.strictEqual(placeWorkspaceContent(current, current.mainId, "float", fallback), current);
  const inactive = { ...current, companionId: "chat:closed" };
  assert.strictEqual(placeWorkspaceContent(inactive, inactive.mainId, "float"), inactive);
});

test("invalid placement requests preserve the current workspace", () => {
  const current = reading();
  for (const [id, position] of [["", "main"], [null, "left"], ["chat:1", "bottom"], ["chat:1", undefined]])
    assert.strictEqual(placeWorkspaceContent(current, id, position), current);
});

test("persisted project views keep only known fields and normalize malformed preferences", () => {
  for (const value of [null, undefined, [], "project", 12, false])
    assert.deepEqual(validWorkspaceViews(value), {});

  const raw = {
    pdf: { mainId: "book:source", comparisonOpen: false, side: "left", floatingIds: ["old"], stale: true },
    graph: { mainId: "graph:chapter", comparisonOpen: true, side: "right" },
    invalidFields: { mainId: 99, comparisonOpen: "false", side: "bottom" },
    empty: {}, nullView: null, arrayView: [], scalarView: "chat:1",
  };
  const before = structuredClone(raw);
  assert.deepEqual(validWorkspaceViews(raw), {
    pdf: { mainId: "book:source", comparisonOpen: false, side: "left" },
    graph: { mainId: "graph:chapter", comparisonOpen: true, side: "right" },
    invalidFields: { mainId: undefined, comparisonOpen: true, side: "right" },
    empty: { mainId: undefined, comparisonOpen: true, side: "right" },
  });
  assert.deepEqual(raw, before);
});
