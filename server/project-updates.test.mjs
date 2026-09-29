import test from "node:test";
import assert from "node:assert/strict";
import {
  createProjectUpdate,
  mergeProjectUpdate,
  revertProjectUpdate,
} from "../src/project-updates.mjs";

const concept = (id, patch = {}) => ({
  id,
  name: id,
  description: `Original ${id}`,
  x: 18,
  y: 25,
  group: 0,
  links: [],
  ...patch,
});
const stage = (id, patch = {}) => ({
  id,
  title: id,
  description: `Original ${id}`,
  tag: "实践",
  done: false,
  prerequisites: [],
  ...patch,
});
const project = () => ({
  id: "project",
  concepts: [concept("a"), concept("untouched")],
  stages: [stage("one")],
  sources: [{ id: "book", progress: 39 }],
  chats: [{ id: "chat", messages: [{ content: "Keep this answer" }] }],
  attempts: [{ id: "attempt", answer: "A" }],
  bookmarks: [{ page: 39 }],
});
const proposal = (patch = {}) => ({
  concepts: [
    concept("a", { description: "AI explanation", links: ["new"] }),
    concept("new"),
  ],
  stages: [
    stage("one", { description: "AI task", check: "Run the example" }),
    stage("two", { prerequisites: ["one"] }),
  ],
  warnings: [],
  ...patch,
});
const frozen = (value) => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(frozen);
  }
  return value;
};

test("an incremental update produces detached snapshots and undoes only its changed objects", () => {
  const before = project();
  const result = createProjectUpdate(before, proposal());
  assert.deepEqual(result.project, mergeProjectUpdate(before, proposal()));
  assert.deepEqual(
    result.receipt.concepts.map((entry) => entry.id),
    ["a", "new"],
  );
  assert.deepEqual(
    result.receipt.stages.map((entry) => entry.id),
    ["one", "two"],
  );
  assert.notEqual(result.receipt.concepts[0].before, before.concepts[0]);
  assert.notEqual(result.receipt.concepts[0].after, result.project.concepts[0]);
  assert.deepEqual(revertProjectUpdate(result.project, result.receipt), {
    project: before,
    retained: 0,
  });
  assert.deepEqual(createProjectUpdate(result.project, proposal()).receipt, {
    concepts: [],
    stages: [],
  });
});

test("receipts survive JSON storage, including missing optional fields and canonical IDs", () => {
  const before = project();
  before.concepts[0].anchors = undefined;
  const update = createProjectUpdate(
    before,
    proposal({
      concepts: [
        concept("renamed-id", {
          name: "a",
          links: ["new"],
          anchors: [{ sourceId: "book", page: 39, title: "Page" }],
        }),
        concept("new", { links: ["renamed-id"] }),
      ],
    }),
  );
  assert.equal(update.receipt.concepts[0].id, "a");
  assert.deepEqual(update.project.concepts.at(-1).links, ["a"]);
  const reloaded = JSON.parse(JSON.stringify(update));
  assert.deepEqual(revertProjectUpdate(reloaded.project, reloaded.receipt), {
    project: JSON.parse(JSON.stringify(before)),
    retained: 0,
  });
});

test("undo restores untouched fields while preserving later text, links, layout, completion and unrelated data", () => {
  const before = project();
  before.concepts[0].layout = { x: 100, y: 200 };
  const update = createProjectUpdate(before, proposal());
  const current = structuredClone(update.project);
  Object.assign(current.concepts[0], {
    description: "My corrected explanation",
    layout: { x: 300, y: 400 },
    links: [],
  });
  current.stages[0].done = true;
  current.stages[0].deliverable = "My implementation";
  current.chats[0].messages.push({ content: "Later answer" });
  current.sources[0].progress = 70;
  current.attempts.push({ id: "later", answer: "B" });
  const result = revertProjectUpdate(current, update.receipt);
  assert.equal(result.retained, 2);
  assert.deepEqual(result.project.concepts[0], {
    ...before.concepts[0],
    description: "My corrected explanation",
    layout: { x: 300, y: 400 },
  });
  assert.deepEqual(result.project.stages[0], {
    ...before.stages[0],
    done: true,
    deliverable: "My implementation",
  });
  assert.equal(result.project.concepts.length, before.concepts.length);
  for (const field of ["chats", "sources", "attempts", "bookmarks"])
    assert.equal(result.project[field], current[field]);
});

test("later references retain unchanged new concepts and prerequisites transitively", () => {
  const update = createProjectUpdate(
    project(),
    proposal({
      concepts: [
        concept("n1", { links: ["n2"] }),
        concept("n2", { links: ["n1"] }),
        concept("unused"),
      ],
      stages: [
        stage("s1", { prerequisites: ["s2"] }),
        stage("s2"),
        stage("unused-stage"),
      ],
    }),
  );
  const current = structuredClone(update.project);
  current.concepts.push(concept("later", { links: ["n1"] }));
  current.stages.push(stage("later-stage", { prerequisites: ["s1"] }));
  const result = revertProjectUpdate(current, update.receipt);
  assert.equal(result.retained, 4);
  assert.deepEqual(
    result.project.concepts.map((item) => item.id),
    ["a", "untouched", "n1", "n2", "later"],
  );
  assert.deepEqual(
    result.project.stages.map((item) => item.id),
    ["one", "s1", "s2", "later-stage"],
  );
  assert.ok(
    result.project.concepts.every((item) =>
      item.links.every((id) =>
        result.project.concepts.some((other) => other.id === id),
      ),
    ),
  );
  assert.ok(
    result.project.stages.every((item) =>
      item.prerequisites.every((id) =>
        result.project.stages.some((other) => other.id === id),
      ),
    ),
  );
});

test("references restored away do not retain new objects, including isolated cycles", () => {
  const before = project();
  const update = createProjectUpdate(
    before,
    proposal({
      concepts: [
        concept("a", { links: ["n1"] }),
        concept("n1", { links: ["n2"] }),
        concept("n2", { links: ["n1"] }),
      ],
      stages: [
        stage("one", { prerequisites: ["s1"] }),
        stage("s1", { prerequisites: ["s2"] }),
        stage("s2"),
      ],
    }),
  );
  assert.deepEqual(revertProjectUpdate(update.project, update.receipt), {
    project: before,
    retained: 0,
  });
});

test("edits to added objects preserve the whole object and the references it needs", () => {
  const update = createProjectUpdate(
    project(),
    proposal({
      concepts: [concept("n1", { links: ["n2"] }), concept("n2")],
      stages: [stage("s1", { prerequisites: ["s2"] }), stage("s2")],
    }),
  );
  const current = structuredClone(update.project);
  current.concepts.find((item) => item.id === "n1").layout = { x: 10, y: 20 };
  current.stages.find((item) => item.id === "s1").done = true;
  const result = revertProjectUpdate(current, update.receipt);
  assert.equal(result.retained, 4);
  assert.deepEqual(result.project, current);
});

test("deleted objects stay deleted and undo does not resurrect before snapshots", () => {
  const update = createProjectUpdate(project(), proposal());
  const current = { ...update.project, concepts: [], stages: [] };
  assert.deepEqual(revertProjectUpdate(current, update.receipt), {
    project: current,
    retained: 0,
  });
});

test("overlapping proposals preserve the later proposal when undoing the earlier one", () => {
  const before = project();
  const first = createProjectUpdate(before, proposal());
  const second = createProjectUpdate(
    first.project,
    proposal({
      concepts: [
        concept("a", { description: "Second explanation", links: ["new"] }),
      ],
      stages: [
        stage("one", { description: "Second task", prerequisites: ["two"] }),
      ],
    }),
  );
  const undoFirst = revertProjectUpdate(second.project, first.receipt);
  assert.equal(undoFirst.retained, 3);
  assert.equal(undoFirst.project.concepts[0].description, "Second explanation");
  assert.deepEqual(undoFirst.project.concepts[0].links, []);
  assert.equal(
    undoFirst.project.concepts.some((item) => item.id === "new"),
    false,
  );
  assert.equal(undoFirst.project.stages[0].description, "Second task");
  assert.equal(
    undoFirst.project.stages.some((item) => item.id === "two"),
    true,
  );
  const undoSecondFirst = revertProjectUpdate(second.project, second.receipt);
  assert.deepEqual(undoSecondFirst.project, first.project);
  assert.deepEqual(
    revertProjectUpdate(undoSecondFirst.project, first.receipt).project,
    before,
  );
});

test("apply and undo never mutate input project, proposal or receipt", () => {
  const before = frozen(project());
  const input = frozen(proposal());
  const update = createProjectUpdate(before, input);
  const receipt = frozen(update.receipt);
  const current = frozen(update.project);
  const result = revertProjectUpdate(current, receipt);
  assert.deepEqual(before, project());
  assert.deepEqual(input, proposal());
  assert.deepEqual(result.project, before);
  result.project.concepts[0].links.push("independent");
  assert.deepEqual(receipt.concepts[0].before.links, []);
});

test("applying a proposal preserves an existing pin and completed stage", () => {
  const before = project();
  before.concepts[0].layout = { x: 10, y: 20 };
  before.stages[0].done = true;
  const update = createProjectUpdate(
    before,
    proposal({
      concepts: [concept("a", { x: 90, y: 90, layout: { x: 90, y: 90 } })],
    }),
  );
  assert.deepEqual(
    update.project.concepts[0].layout,
    before.concepts[0].layout,
  );
  assert.equal(update.project.concepts[0].x, before.concepts[0].x);
  assert.equal(update.project.stages[0].done, true);
});

test("undoing overlapping proposals out of order never restores references to removed additions", () => {
  const before = project();
  const first = createProjectUpdate(
    before,
    proposal({
      concepts: [concept("a", { links: ["new"] }), concept("new")],
      stages: [stage("one", { prerequisites: ["two"] }), stage("two")],
    }),
  );
  const second = createProjectUpdate(
    first.project,
    proposal({
      concepts: [
        concept("a", { description: "Second explanation", links: [] }),
      ],
      stages: [stage("one", { description: "Second task", prerequisites: [] })],
    }),
  );
  const undoFirst = revertProjectUpdate(second.project, first.receipt);
  assert.equal(
    undoFirst.project.concepts.some((item) => item.id === "new"),
    false,
  );
  assert.equal(
    undoFirst.project.stages.some((item) => item.id === "two"),
    false,
  );
  const undoSecond = revertProjectUpdate(undoFirst.project, second.receipt);
  assert.deepEqual(undoSecond.project, before);
});

test("undo does not restore old references whose targets were subsequently deleted by the user", () => {
  const before = project();
  before.concepts[0].links = ["old"];
  before.concepts.push(concept("old"));
  before.stages[0].prerequisites = ["old-stage"];
  before.stages.push(stage("old-stage"));
  const update = createProjectUpdate(
    before,
    proposal({
      concepts: [concept("a", { links: ["new"] }), concept("new")],
      stages: [stage("one", { prerequisites: ["two"] }), stage("two")],
    }),
  );
  const current = {
    ...update.project,
    concepts: update.project.concepts.filter((item) => item.id !== "old"),
    stages: update.project.stages.filter((item) => item.id !== "old-stage"),
  };
  const result = revertProjectUpdate(current, update.receipt);
  assert.deepEqual(result.project.concepts, project().concepts);
  assert.deepEqual(result.project.stages, project().stages);
  assert.equal(result.retained, 2);
});
