import test from "node:test";
import assert from "node:assert/strict";
import { emptyProjectPathTutor, readingDestination, knowledgeGraphOwner, relatedPaperOptions, learningObjectNodes } from "../src/paper-navigation.mjs";

function fixture() {
  return {
    id: "p", sources: ["a", "b"].map((id) => ({ id, title: `资料${id}`, pages: Array(20).fill("text"), progress: 8 })), chats: [], stages: [], sets: [], papers: [],
    paperTree: { rootId: "project:p", tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: "project:p" },
      { id: "graph", kind: "graph", parentId: "tutor" },
      { id: "path", kind: "path", parentId: "tutor" },
      { id: "book:a", kind: "book", role: "source", sourceId: "a", parentId: "project:p" },
      { id: "chapter:a", kind: "book", role: "chapter", title: "第一章", sourceId: "a", parentId: "book:a", anchor: { sourceId: "a", page: 3 }, endPage: 12 },
      { id: "section:a", kind: "book", role: "chapter", title: "第一节", sourceId: "a", parentId: "chapter:a", anchor: { sourceId: "a", page: 5 }, endPage: 7 },
      { id: "graph:a", kind: "graph", role: "scope-graph", parentId: "chapter:a" },
      { id: "chat:a", kind: "chat", parentId: "chapter:a" },
      { id: "chat:source", kind: "chat", parentId: "book:a" },
      { id: "book:b", kind: "book", role: "source", sourceId: "b", parentId: "project:p" },
      { id: "chapter:b", kind: "book", role: "chapter", sourceId: "b", parentId: "book:b", anchor: { sourceId: "b", page: 1 }, endPage: 20 },
      { id: "stage:one", kind: "path", role: "stage", sourceId: "a", parentId: "path" },
      { id: "old:graph", kind: "graph", parentId: "chapter:a" },
    ] },
  };
}

test("opening an empty project path resolves the existing tutor without changing project or target", () => {
  const p = fixture();
  const tutor = p.paperTree.nodes.find((node) => node.id === p.paperTree.tutorId);
  tutor.objectId = "project-tutor-conversation";
  const target = { id: "path", kind: "path" };
  const before = structuredClone(p);
  assert.equal(emptyProjectPathTutor(p, target), tutor);
  assert.equal(emptyProjectPathTutor(p, target).objectId, "project-tutor-conversation");
  assert.deepEqual(p, before);
  assert.deepEqual(target, { id: "path", kind: "path" });
});

test("a project path with stages keeps its path destination", () => {
  const p = fixture();
  p.stages.push({ id: "one", title: "First stage" });
  assert.equal(emptyProjectPathTutor(p, { id: "path", kind: "path" }), undefined);
});

test("other papers, historical paths, and individual stages are never redirected", () => {
  const p = fixture();
  for (const target of [
    { id: "graph", kind: "graph" },
    { id: "tutor", kind: "chat" },
    { id: "path", kind: "chat" },
    { id: "snapshot:path", kind: "path", role: "history" },
    { id: "stage:one", kind: "path", role: "stage" },
  ]) assert.equal(emptyProjectPathTutor(p, target), undefined);
});

test("empty project paths do not invent or substitute a missing tutor", () => {
  const target = { id: "path", kind: "path" };
  const p = fixture();
  delete p.paperTree.tutorId;
  assert.equal(emptyProjectPathTutor(p, target), undefined);
  p.paperTree.tutorId = "missing";
  assert.equal(emptyProjectPathTutor(p, target), undefined);
  delete p.paperTree;
  assert.equal(emptyProjectPathTutor(p, target), undefined);
});

test("a configured tutor with a non-chat kind is not a conversation destination", () => {
  const p = fixture();
  p.paperTree.nodes.find((node) => node.id === p.paperTree.tutorId).kind = "paper";
  assert.equal(emptyProjectPathTutor(p, { id: "path", kind: "path" }), undefined);
});

test("references keep a preferred valid chapter, otherwise use the narrowest chapter", () => {
  const p = fixture();
  const anchor = { sourceId: "a", page: 6 };
  assert.equal(readingDestination(p, anchor, "chapter:a").id, "chapter:a");
  assert.equal(readingDestination(p, anchor).id, "section:a");
  assert.equal(readingDestination(p, { sourceId: "a", page: 8 }, "section:a").id, "chapter:a");
  assert.equal(readingDestination(p, { sourceId: "a", page: 18 }).id, "book:a");
  assert.deepEqual(anchor, { sourceId: "a", page: 6 });
});

test("references use the deeper chapter for equal spans and retain stable ties", () => {
  const p = fixture();
  const parent = p.paperTree.nodes.find((n) => n.id === "chapter:a");
  p.paperTree.nodes.push({ ...parent, id: "same-child", parentId: parent.id });
  p.paperTree.nodes.push({ ...parent, id: "same-child-2", parentId: parent.id });
  assert.equal(readingDestination(p, { sourceId: "a", page: 8 }).id, "same-child");
});

test("cross-source and invalid references never use the current chapter or clamp physical pages", () => {
  const p = fixture();
  assert.equal(readingDestination(p, { sourceId: "b", page: 6 }, "chapter:a").id, "chapter:b");
  for (const page of [0, -1, 21, 1.5, NaN, "6"]) assert.equal(readingDestination(p, { sourceId: "a", page }), undefined);
  p.sources = p.sources.filter((s) => s.id !== "a");
  assert.equal(readingDestination(p, { sourceId: "a", page: 6 }, "chapter:a"), undefined);
});

test("chapter graph and branches use chapter ownership; stages and historical graphs use project ownership", () => {
  const p = fixture();
  for (const id of ["chapter:a", "graph:a", "chat:a"]) assert.equal(knowledgeGraphOwner(p, id).id, "chapter:a");
  for (const id of ["book:a", "path", "stage:one", "old:graph", "missing", "graph"]) assert.equal(knowledgeGraphOwner(p, id).id, "tutor");
  p.paperTree.nodes.push({ id: "stage-chat", kind: "chat", parentId: "stage:one" });
  assert.equal(knowledgeGraphOwner(p, "stage-chat").id, "tutor");
});

test("saved conversation scope wins over display parents and never guesses a chapter from source progress", () => {
  const p = fixture();
  const chat = { id: "chat:a", context: { scopeNodeId: "chapter:b", sourceId: "b" } };
  p.chats.push(chat);
  assert.equal(knowledgeGraphOwner(p, "chat:a").id, "chapter:b");
  chat.context.scopeNodeId = "stage:one";
  assert.equal(knowledgeGraphOwner(p, "chat:a").id, "tutor");
  chat.context.scopeNodeId = "deleted";
  assert.equal(knowledgeGraphOwner(p, "chat:a").id, "tutor");
  delete chat.context.scopeNodeId;
  assert.equal(knowledgeGraphOwner(p, "chat:a").id, "tutor");
  p.chats.push({ id: "book:a", context: { scopeNodeId: "chapter:a" } });
  assert.equal(knowledgeGraphOwner(p, "book:a").id, "tutor");
});

test("deleted chapter sources and cyclic ancestry safely fall back to the project", () => {
  const p = fixture();
  p.sources = p.sources.filter((s) => s.id !== "a");
  assert.equal(knowledgeGraphOwner(p, "graph:a").id, "tutor");
  p.paperTree.nodes.push({ id: "cycle-a", kind: "chat", parentId: "cycle-b" }, { id: "cycle-b", kind: "chat", parentId: "cycle-a" });
  assert.equal(knowledgeGraphOwner(p, "cycle-a").id, "tutor");
});

test("related options prioritize chapter, material and project with distinct graph titles", () => {
  const p = fixture();
  const before = structuredClone(p);
  const options = relatedPaperOptions(p, "chapter:a");
  assert.deepEqual(options.filter((o) => o.group === "本章").map((o) => o.id), ["chat:a", "graph:a"]);
  assert.equal(options.find((o) => o.id === "graph:a").title, "知识图谱 · 第一章");
  assert.equal(options.find((o) => o.id === "chat:source").group, "这份资料");
  assert.equal(options.find((o) => o.id === "section:a").group, "这份资料");
  assert.equal(options.find((o) => o.id === "graph").title, "项目知识图谱");
  assert.deepEqual(options.filter((o) => o.group === "项目").map((o) => o.id), ["tutor", "graph", "path"]);
  assert.equal(options.some((o) => o.id === "stage:one"), false);
  assert.equal(options.some((o) => o.id === "chapter:a"), false);
  assert.deepEqual(p, before);
});

test("related source discussion options follow explicit context and stay duplicate-free and stable", () => {
  const p = fixture();
  p.chats.push({ id: "chat:source", context: { scopeNodeId: "chapter:a", sourceId: "a" } });
  p.paperTree.nodes.push({ ...p.paperTree.nodes.find((n) => n.id === "graph:a") });
  const first = relatedPaperOptions(p, "chapter:a");
  assert.equal(first.find((o) => o.id === "chat:source").group, "本章");
  assert.equal(new Set(first.map((o) => o.id)).size, first.length);
  assert.deepEqual(relatedPaperOptions(p, "chapter:a"), first);
  const wholeSource = relatedPaperOptions(p, "book:a");
  assert.equal(wholeSource.some((o) => o.group === "本章"), false);
});

test("project options expose independent conversations while child papers remain local", () => {
  const p = fixture();
  p.paperTree.nodes.push(
    { id: "reply", kind: "chat", parentId: "chat:a", conversationRoot: false },
    { id: "formula", kind: "paper", parentId: "chat:a" },
    { id: "exercise", kind: "questions", parentId: "reply" },
    { id: "snapshot", kind: "graph", role: "history", parentId: "chat:a" },
    { id: "independent", kind: "chat", parentId: "chapter:a", conversationRoot: true },
  );
  const ids = relatedPaperOptions(p, "chapter:a").map((option) => option.id);
  assert.ok(ids.includes("chat:a"));
  assert.ok(ids.includes("independent"));
  assert.ok(!ids.includes("reply"));
  for (const hidden of ["formula", "exercise", "snapshot"]) assert.ok(!ids.includes(hidden));
});


test("object shelf and comparison retain reusable objects after removal from the project tree", () => {
  const p = fixture();
  p.sets = [
    { id: "chapter", title: "本章练习", scopeNodeId: "chapter:a", questions: [{ id: "q" }] },
    { id: "project", title: "项目练习", scopeNodeId: "tutor", questions: [{ id: "q" }] },
    { id: "inline", title: "随堂检测", scopeNodeId: "chapter:a", presentation: "inline", questions: [{ id: "q" }] },
    { id: "empty", title: "草稿", questions: [] },
  ];
  p.paperTree.nodes.push(
    { id: "questions", kind: "questions", parentId: "tutor" },
    ...p.sets.map((set) => ({ id: `questions:${set.id}`, objectId: set.id, kind: "questions", parentId: "chat:a" })),
    { id: "formula", kind: "paper", parentId: "chat:a" },
    { id: "snapshot", kind: "graph", role: "history", parentId: "chat:a" },
  );
  const before = structuredClone(p);
  const shelf = learningObjectNodes(p);
  assert.deepEqual(shelf.map((node) => node.id), ["graph", "path", "graph:a", "questions", "questions:chapter", "questions:project"]);
  const options = relatedPaperOptions(p, "chapter:a");
  assert.equal(options.find((o) => o.id === "questions:chapter").group, "本章");
  assert.equal(options.find((o) => o.id === "questions:project").group, "项目");
  assert.equal(options.find((o) => o.id === "questions").group, "项目");
  for (const id of ["formula", "snapshot", "questions:inline", "questions:empty", "stage:one"]) assert.equal(options.some((o) => o.id === id), false);
  assert.equal(relatedPaperOptions(p, "questions:chapter").find((o) => o.id === "graph:a").group, "本章");
  assert.deepEqual(p, before);
  p.sources = p.sources.filter((source) => source.id !== "a");
  assert.equal(learningObjectNodes(p).some((node) => node.id === "graph:a"), false);
  assert.equal(relatedPaperOptions(p, "tutor").find((o) => o.id === "questions:chapter").group, "项目");
});


test("the object shelf includes saved objects once while inline-only practice stays in its paper", () => {
  const p = fixture();
  p.papers = [
    { id: "paper:one", object: { id: "formula:one", kind: "formula", content: "a+b" } },
    { id: "paper:duplicate", object: { id: "formula:one", kind: "formula", content: "a+b" } },
    { id: "paper:question", object: { id: "question:one", kind: "question", content: "why?" } },
  ];
  p.sets = [{ id: "inline", presentation: "inline", questions: [{ id: "q" }] }];
  p.paperTree.nodes.push(
    ...p.papers.map((paper) => ({ id: paper.id, kind: "paper", objectId: paper.id, parentId: "chat:a" })),
    { id: "paper:alias", kind: "paper", objectId: "paper:one", parentId: "chat:a" },
    { id: "paper:missing", kind: "paper", objectId: "deleted", parentId: "chat:a" },
    { id: "questions:inline", kind: "questions", objectId: "inline", parentId: "chat:a" },
  );
  const before = structuredClone(p), objects = learningObjectNodes(p);
  assert.deepEqual(objects.filter((node) => node.kind === "paper").map((node) => node.id), ["paper:one", "paper:question"]);
  assert.equal(objects.some((node) => node.id === "questions:inline"), false);
  assert.equal(objects.some((node) => node.id === "graph:a"), true);
  assert.deepEqual(p, before);
});
