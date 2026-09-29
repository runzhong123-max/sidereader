import test from "node:test";
import assert from "node:assert/strict";
import { conceptDropTarget, deliverConceptDrop, markConceptDropTarget } from "../src/concept-pointer-drop.mjs";

function tutor(projectId) {
  const target = new EventTarget(), attributes = new Map([["data-concept-drop",projectId]]);
  return Object.assign(target, {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name,value) => attributes.set(name,value),
    removeAttribute: (name) => attributes.delete(name),
  });
}

test("pointer references target the visible same-project conversation and do not drop onto the source graph", () => {
  const target = tutor("p"), hit = {closest: () => target};
  const screen = {elementFromPoint: () => hit};
  assert.equal(conceptDropTarget("p",10,20,null,screen),target);
  assert.equal(conceptDropTarget("other",10,20,null,screen),null);
  assert.equal(conceptDropTarget("p",10,20,{contains: (node) => node === hit},screen),null);
  assert.equal(conceptDropTarget("p",10,20,null,{elementFromPoint: () => null}),null);
});

test("moving or cancelling a drag clears the previous conversation highlight", () => {
  const first = tutor("p"), second = tutor("p");
  let active = markConceptDropTarget(null,first);
  assert.equal(first.getAttribute("data-concept-drag-over"),"true");
  active = markConceptDropTarget(active,second);
  assert.equal(first.getAttribute("data-concept-drag-over"),null);
  assert.equal(second.getAttribute("data-concept-drag-over"),"true");
  assert.equal(markConceptDropTarget(active,null),null);
  assert.equal(second.getAttribute("data-concept-drag-over"),null);
});

test("both graph presentations deliver only a reference identity, never a submitted question", () => {
  const target = tutor("p"), received = [];
  target.addEventListener("sidereader:concept-drop",(event) => received.push(event.detail));
  assert.equal(deliverConceptDrop(target,"other","concept"),false);
  assert.equal(deliverConceptDrop(null,"p","concept"),false);
  assert.equal(deliverConceptDrop(target,"p","concept"),true);
  assert.deepEqual(received,[{version:1,projectId:"p",kind:"concept",conceptId:"concept"}]);
});
