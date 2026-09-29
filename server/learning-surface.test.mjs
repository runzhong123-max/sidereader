import test from "node:test";
import assert from "node:assert/strict";
import { surfaceContent } from "../src/domain/learning-surface.mjs";
import { questionObject } from "../src/question-state.mjs";

const question = { id: "q", type: "short", prompt: "当前题干", options: [], answer: "当前答案" };
const set = { id: "set", title: "练习", questions: [question] };
const paper = { id: "paper", object: { ...questionObject(set.id, question), question: { ...question, prompt: "旧题干" } } };
const project = {
  concepts: [{ id: "a" }, { id: "b" }], stages: [{ id: "s1" }, { id: "s2" }], sets: [set], papers: [paper],
  paperTree: { nodes: [
    { id: "graph-empty", kind: "graph", conceptIds: [] },
    { id: "graph-subset", kind: "graph", conceptIds: ["b", "deleted", "b"] },
    { id: "graph", kind: "graph" },
    { id: "stage", kind: "path", stageIds: ["s2"] },
    { id: "path-empty", kind: "path", stageIds: [] },
    { id: "questions-node", kind: "questions", objectId: "set" },
    { id: "paper-node", kind: "paper", objectId: "paper" },
  ] },
};

test("all surface presentations preserve empty and bounded collection membership", () => {
  assert.deepEqual(surfaceContent(project, { id: "graph-empty", kind: "graph" }).concepts, []);
  assert.deepEqual(surfaceContent(project, { id: "graph-subset", kind: "graph" }).concepts, [project.concepts[1]]);
  assert.equal(surfaceContent(project, { id: "graph", kind: "graph" }).concepts, project.concepts);
  assert.deepEqual(surfaceContent(project, { id: "stage", kind: "path" }).stages, [project.stages[1]]);
  assert.deepEqual(surfaceContent(project, { id: "path-empty", kind: "path" }).stages, []);
});

test("canonical practice file references override stale presentation tabs without leaking other sets", () => {
  const content = surfaceContent(project, { id: "questions-node", kind: "questions", objectId: "stale" });
  assert.equal(content.setId, "set");
  assert.deepEqual(content.sets, [set]);
  assert.deepEqual(surfaceContent(project, { id: "deleted", kind: "questions", objectId: "deleted" }).sets, []);
  assert.equal(surfaceContent(project, { id: "questions", kind: "questions" }).sets, project.sets);
});

test("paper presentations reference one saved view while editable question content stays current", () => {
  const content = surfaceContent(project, { id: "paper-node", kind: "paper" });
  assert.equal(content.paper, paper);
  assert.equal(content.object.id, paper.object.id);
  assert.equal(content.object.question, question);
  assert.equal(paper.object.question.prompt, "旧题干", "resolving a view must not mutate saved provenance");
  const deletedSource = surfaceContent({ ...project, sets: [] }, { id: "paper-node", kind: "paper" });
  assert.equal(deletedSource.object, paper.object, "a missing source retains its saved snapshot");
});
