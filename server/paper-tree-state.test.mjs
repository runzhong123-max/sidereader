import test from "node:test";
import assert from "node:assert/strict";
import {
  addProposalNodes,
  attachPaperNode,
  ensureScopeGraph,
  nodeTitle,
  normalizePaperTree,
  paperAncestors,
  scopeGraphId,
} from "../src/paper-tree-state.mjs";
import { createProjectUpdate, revertProjectUpdate } from "../src/project-updates.mjs";
import { sourceSections } from "../src/source-sections.mjs";

const concept = (id, patch = {}) => ({ id, name: id, description: id, x: 10, y: 20, group: 0, links: [], ...patch });
const stage = (id, patch = {}) => ({ id, title: id, description: id, tag: "练习", done: false, prerequisites: [], ...patch });
const source = (id) => ({ id, title: `教材 ${id}`, pages: ["原文"], progress: 1 });
const chat = (id, messages = [], patch = {}) => ({ id, title: `对话 ${id}`, messages, ...patch });
const paper = (id, parentId) => ({ id, parentId, parentTitle: "原父纸张", parentTab: { id: parentId, kind: "chat" }, title: `纸张 ${id}`, object: { id: `object:${id}`, kind: "note", title: `纸张 ${id}`, content: "原内容" }, evidence: [], created: "2026-09-23" });
const project = (patch = {}) => ({
  id: "project", version: 1, name: "项目", goal: "学习", sources: [], concepts: [], stages: [], sets: [], papers: [],
  activeSource: "", page: 1, chats: [chat("root")], tabs: [{ id: "root", kind: "chat" }], activeTab: "root", ...patch,
});
const node = (project, id) => project.paperTree.nodes.find((item) => item.id === id);
function frozen(value) {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
}

test("migration indexes closed entities, preserves data and active tab, and honors legacy paper ancestry", () => {
  const before = frozen(project({
    sources: [source("book")],
    chats: [chat("root"), chat("closed"), chat("book:book", [{ id: "answer", role: "assistant", content: "历史辅导" }]), chat("paper:one")],
    tabs: [{ id: "root", kind: "chat" }, { id: "paper:two", kind: "paper", objectId: "paper:two" }, { id: "book:book", kind: "book", sourceId: "book" }],
    activeTab: "book:book",
    concepts: [concept("a")], stages: [stage("a")], sets: [{ id: "set", title: "练习", questions: [] }],
    papers: [paper("paper:one", "closed"), paper("paper:two", "paper:one")],
    attempts: [{ id: "attempt", answer: "A" }], bookmarks: [{ id: "anchor", page: 1 }],
  }));
  const result = normalizePaperTree(before);
  assert.equal(result.paperTree.rootId, "project:project");
  assert.equal(result.paperTree.tutorId, "root");
  assert.equal(node(result, "root").parentId, "project:project");
  assert.equal(node(result, "paper:two").parentId, "paper:one");
  assert.equal(node(result, "paper:one").parentId, "closed");
  assert.equal(node(result, "closed").parentId, "root");
  assert.deepEqual(paperAncestors(result, "paper:two").map((item) => item.id), ["root", "closed", "paper:one"]);
  for (const id of ["graph", "path", "questions:set", "book:book", "discussion:book:book"]) assert.ok(node(result, id));
  assert.equal(node(result, "book:book").kind, "book");
  assert.equal(node(result, "paper:one").kind, "paper");
  assert.equal(node(result, "discussion:book:book").objectId, "book:book");
  assert.equal(node(result, "discussion:book:book").parentId, "book:book");
  assert.equal(node(result, "discussion:paper:one"), undefined);
  assert.equal(result.activeTab, before.activeTab);
  for (const field of ["sources", "chats", "concepts", "stages", "sets", "papers", "attempts", "bookmarks", "tabs"]) assert.equal(result[field], before[field]);
  assert.equal(normalizePaperTree(result), result);
});

test("a project with only shared tutor chats gets a deterministic empty main chat without losing history", () => {
  const before = project({ sources: [source("book")], chats: [chat("book:book", [{ id: "m", content: "保留" }])], tabs: [{ id: "book:book", kind: "book", sourceId: "book" }], activeTab: "book:book" });
  const result = normalizePaperTree(before);
  assert.equal(result.paperTree.rootId, "project:project");
  assert.equal(result.paperTree.tutorId, "main:project");
  assert.deepEqual(result.chats.at(-1), { id: "main:project", title: "项目 Tutor", messages: [] });
  assert.equal(result.chats[0], before.chats[0]);
  assert.equal(result.activeTab, "book:book");
  assert.equal(normalizePaperTree(result), result);
  assert.deepEqual(normalizePaperTree(before), result);
});

test("practice overview migration preserves sets, attempts, drafts, active set and original source ancestry", () => {
  const book = { ...source("book"), pages: ["第一章", "第二页"], outline: [{ title: "第一章", page: 1, level: 1, kind: "chapter" }] };
  const chapterId = sourceSections(book)[0].id;
  const set = { id: "set", title: "章节自测", questions: [{ id: "q", type: "choice", prompt: "问题", choices: ["A", "B"], answer: "A" }] };
  const before = frozen(project({
    sources: [book], sets: [set],
    chats: [chat("root"), chat("chapter-chat", [], { context: { parentId: chapterId, scopeNodeId: chapterId } })],
    attempts: [{ id: "attempt", objectId: "question:set:q", answer: "A" }],
    questionDrafts: { "question:set:q": { answer: "A" } }, practicePositions: { set: "q" },
    papers: [{ ...paper("paper:q", "chapter-chat"), object: { id: "question:set:q", kind: "question", title: "问题", question: set.questions[0] } }],
    tabs: [{ id: "questions:set", kind: "questions", objectId: "set" }], activeTab: "questions:set",
    paperTree: { version: 2, rootId: "project:project", tutorId: "root", nodes: [
      { id: "root", kind: "chat", parentId: "project:project", origin: "root" },
      { id: "chapter-chat", kind: "chat", parentId: chapterId, origin: "manual" },
      { id: "questions:set", kind: "questions", objectId: "set", parentId: "chapter-chat", sourceMessageId: "answer", origin: "object" },
    ] },
  }));
  const result = normalizePaperTree(before);
  assert.equal(node(result, "questions").kind, "questions");
  assert.equal(node(result, "questions").parentId, "root");
  assert.equal(nodeTitle(result, node(result, "questions")), "练习总览");
  assert.equal(node(result, "questions:set"), before.paperTree.nodes[2]);
  assert.deepEqual(paperAncestors(result, "questions:set").map((item) => item.id), ["book:book", chapterId, "chapter-chat"]);
  assert.equal(result.activeTab, before.activeTab);
  for (const field of ["sets", "papers", "attempts", "questionDrafts", "practicePositions", "chats", "tabs"]) assert.equal(result[field], before[field]);
  assert.equal(normalizePaperTree(result), result);
  assert.deepEqual(normalizePaperTree(before), result);
});

test("practice overview is always available and its canonical parent and label survive legacy customization", () => {
  const initial = normalizePaperTree(project());
  const result = normalizePaperTree({ ...initial, paperTree: { ...initial.paperTree, nodes: initial.paperTree.nodes.map((item) => item.id === "questions" ? { ...item, parentId: "graph", role: "history", title: "旧题目文件" } : item) } });
  assert.equal(result.paperTree.nodes.filter((item) => item.id === "questions").length, 1);
  assert.equal(node(result, "questions").parentId, result.paperTree.tutorId);
  assert.equal(node(result, "questions").role, undefined);
  assert.equal(nodeTitle(result, node(result, "questions")), "练习总览");
  assert.equal(result.sets.length, 0);
  assert.equal(normalizePaperTree(result), result);
});

test("explicitly opened empty legacy tutor chats become discussion nodes and preserve their active session", () => {
  const before = project({ sources: [source("book")], chats: [chat("root"), chat("book:book")], tabs: [{ id: "book:book", kind: "chat" }], activeTab: "book:book" });
  const result = normalizePaperTree(before);
  assert.equal(result.activeTab, "discussion:book:book");
  assert.deepEqual(result.tabs, [{ id: "discussion:book:book", kind: "chat", objectId: "book:book" }]);
  assert.equal(node(result, "discussion:book:book").parentId, "book:book");
  assert.equal(normalizePaperTree(result), result);
});

test("legacy reading conversations keep their session, descendants and source references when normalized", () => {
  const original = project({
    sources: [source("book")],
    chats: [chat("root"), chat("book:book", [
      { id: "question", role: "user", content: "为什么要更新二分查找的左边界？" },
      { id: "answer", role: "assistant", content: "原回答", readingContext: { sourceId: "book", page: 1 } },
    ], { title: "教材 book" }), chat("followup", [], { context: { parentId: "discussion:book:book", sourceMessageId: "answer", quote: "原回答" } })],
    papers: [paper("paper:result", "discussion:book:book")],
    tabs: [{ id: "discussion:book:book", kind: "chat", objectId: "book:book" }],
    activeTab: "discussion:book:book",
    paperTree: { version: 2, rootId: "project:project", tutorId: "root", nodes: [
      { id: "root", kind: "chat", parentId: "project:project", origin: "root" },
      { id: "book:book", kind: "book", role: "source", sourceId: "book", parentId: "project:project" },
      { id: "discussion:book:book", kind: "chat", objectId: "book:book", parentId: "book:book", origin: "legacy" },
      { id: "followup", kind: "chat", parentId: "discussion:book:book", sourceMessageId: "answer", origin: "selection" },
      { id: "paper:result", kind: "paper", objectId: "paper:result", parentId: "discussion:book:book", sourceMessageId: "answer" },
    ] },
  });
  const before = frozen(original);
  const result = normalizePaperTree(before);
  assert.equal(result.activeTab, "discussion:book:book");
  assert.equal(node(result, "discussion:book:book").objectId, "book:book");
  assert.equal(node(result, "discussion:book:book").parentId, "book:book");
  for (const id of ["followup", "paper:result"]) {
    assert.equal(node(result, id).parentId, "discussion:book:book");
    assert.equal(node(result, id).sourceMessageId, "answer");
  }
  for (const field of ["chats", "sources", "papers", "tabs"]) assert.equal(result[field], before[field]);
  assert.equal(nodeTitle(result, node(result, "discussion:book:book")), "为什么要更新二分查找的左边界？");
  assert.equal(normalizePaperTree(result), result);
});

test("opening a source with an empty legacy shared chat does not add another conversation entry", () => {
  const result = normalizePaperTree(project({
    sources: [source("book")],
    chats: [chat("root"), chat("book:book", [], { title: "教材 book" })],
    tabs: [{ id: "book:book", kind: "book", sourceId: "book" }], activeTab: "book:book",
  }));
  assert.equal(node(result, "discussion:book:book"), undefined);
  assert.equal(result.paperTree.nodes.filter((item) => item.kind === "chat").length, 1);
  assert.equal(result.chats.find((item) => item.id === "book:book").messages.length, 0);
  assert.equal(normalizePaperTree(result), result);
});

test("legacy reading aliases show their topic without replacing saved titles or messages", () => {
  const messages = [
    { id: "setup", role: "assistant", content: "这不应成为话题标题" },
    { id: "blank", role: "user", content: "  \n  " },
    { id: "question", role: "user", content: "请解释\n  二分查找的边界" },
    { id: "later", role: "user", content: "后一个问题不应替代标题" },
  ];
  for (const title of ["阅读讨论", "新的对话", "教材 book"]) {
    const result = normalizePaperTree(project({ sources: [source("book")], chats: [chat("root"), chat("book:book", messages, { title })] }));
    const alias = node(result, "discussion:book:book");
    assert.equal(nodeTitle(result, alias), "请解释 二分查找的边界", title);
    assert.equal(result.chats[1].title, title);
    assert.equal(result.chats[1].messages, messages);
    assert.equal(nodeTitle(result, { ...alias, title: "自己整理的话题" }), "自己整理的话题");
  }
  const named = normalizePaperTree(project({ sources: [source("book")], chats: [chat("root"), chat("book:book", messages, { title: "二分查找的边界更新" })] }));
  assert.equal(nodeTitle(named, node(named, "discussion:book:book")), "二分查找的边界更新");
  const longPrompt = `比较边界 ${"解释边界更新的原因 ".repeat(30)}`;
  const long = normalizePaperTree(project({ sources: [source("book")], chats: [chat("root"), chat("book:book", [{ id: "long", role: "user", content: longPrompt }], { title: "阅读讨论" })] }));
  const label = nodeTitle(long, node(long, "discussion:book:book"));
  assert.ok(label.startsWith("比较边界"));
  assert.ok(label.length < longPrompt.length);
  assert.doesNotMatch(label, /\s{2,}|\n/);
});

test("removing backing sources, sets and papers removes only their nodes and promotes surviving children", () => {
  const initial = normalizePaperTree(project({ sources: [source("book")], sets: [{ id: "set", questions: [] }], papers: [paper("paper:one", "book:book")], chats: [chat("root"), chat("child", [], { context: { parentId: "paper:one", quote: "我的问题" } }), chat("book:book", [{ id: "m", content: "原辅导" }])] }));
  const edited = { ...initial, sources: [], sets: [], papers: [] };
  const result = normalizePaperTree(edited);
  for (const id of ["book:book", "questions:set", "paper:one"]) assert.equal(node(result, id), undefined);
  assert.equal(node(result, "child").parentId, "root");
  assert.equal(node(result, "discussion:book:book").parentId, "root");
  assert.equal(result.chats, initial.chats);
  assert.equal(normalizePaperTree(result), result);
});

test("cycle repair detaches a cycle member while preserving descendants and sibling order", () => {
  const before = project({
    chats: [chat("root"), chat("a"), chat("b"), chat("leaf"), chat("orphan")],
    paperTree: { version: 1, rootId: "root", nodes: [
      { id: "root", kind: "chat", parentId: null, origin: "root" },
      { id: "leaf", kind: "chat", parentId: "a" },
      { id: "a", kind: "chat", parentId: "b" },
      { id: "b", kind: "chat", parentId: "a" },
      { id: "orphan", kind: "chat", parentId: "missing" },
    ] },
  });
  const result = normalizePaperTree(frozen(before));
  assert.deepEqual(result.paperTree.nodes.map((item) => item.id).slice(0, 5), ["root", "leaf", "a", "b", "orphan"]);
  assert.equal(node(result, "leaf").parentId, "a");
  assert.equal(node(result, "a").parentId, "root");
  assert.equal(node(result, "b").parentId, "a");
  assert.equal(node(result, "orphan").parentId, "root");
  assert.equal(normalizePaperTree(result), result);
});

test("closing and reopening tabs never deletes, duplicates, or reparents nodes", () => {
  const initial = normalizePaperTree(project({ chats: [chat("root"), chat("child", [], { context: { parentId: "root" } })], tabs: [{ id: "root", kind: "chat" }, { id: "child", kind: "chat" }], activeTab: "child" }));
  const closed = normalizePaperTree({ ...initial, tabs: [], activeTab: "child" });
  assert.equal(closed.paperTree, initial.paperTree);
  assert.deepEqual(closed.tabs, [{ id: "root", kind: "chat" }]);
  assert.equal(closed.activeTab, "root");
  assert.equal(closed.chats, initial.chats);
  const reopened = normalizePaperTree({ ...closed, tabs: [...closed.tabs, { id: "child", kind: "chat" }], activeTab: "child" });
  assert.equal(reopened.paperTree, initial.paperTree);
  assert.equal(attachPaperNode(reopened, { id: "child", kind: "chat", parentId: "child", title: "Do not rename" }), reopened);
});

test("explicit attachment wins over entity migration for new nodes and never activates a tab", () => {
  const initial = normalizePaperTree(project({ sources: [source("book")] }));
  const withEntity = { ...initial, chats: [...initial.chats, chat("new")] };
  const result = attachPaperNode(withEntity, { id: "new", kind: "chat", parentId: "book:book", origin: "selection", quote: "选中的文本" });
  assert.equal(node(result, "new").parentId, "book:book");
  assert.equal(node(result, "new").quote, "选中的文本");
  assert.equal(result.activeTab, initial.activeTab);
  assert.equal(result.tabs, initial.tabs);
  const orphan = attachPaperNode(result, { id: "missing-parent", kind: "chat", parentId: "missing" });
  assert.equal(node(orphan, "missing-parent").parentId, "root");
  assert.equal(normalizePaperTree(orphan), orphan);
});

test("explicit attachment retains its requested parent when entity, tab and active ID arrive together", () => {
  const initial = normalizePaperTree(project({ sources: [source("book")] }));
  const newTab = { id: "selection", kind: "chat" };
  const requested = { ...initial, chats: [...initial.chats, chat("selection")], tabs: [...initial.tabs, newTab], activeTab: newTab.id };
  const result = attachPaperNode(requested, { ...newTab, parentId: "book:book", origin: "selection", sourceMessageId: "message", quote: "这段内容" });
  assert.equal(node(result, "selection").parentId, "book:book");
  assert.equal(node(result, "selection").origin, "selection");
  assert.equal(node(result, "selection").sourceMessageId, "message");
  assert.equal(result.activeTab, "selection");
  assert.equal(result.tabs, requested.tabs);
  assert.equal(result.chats, requested.chats);
  assert.equal(normalizePaperTree(result), result);
  const newBook = source("new-book");
  const bookTab = { id: "book:new-book", kind: "book", sourceId: "new-book" };
  const imported = attachPaperNode({ ...result, sources: [...result.sources, newBook], tabs: [...result.tabs, bookTab], activeTab: bookTab.id }, { ...bookTab, parentId: "selection", origin: "import" });
  assert.equal(node(imported, bookTab.id).parentId, "project:project");
  assert.equal(node(imported, bookTab.id).origin, "import");
  assert.equal(imported.activeTab, bookTab.id);
});

test("project proposals update its one graph and one map without adding result views", () => {
  const initial = normalizePaperTree(project({
    concepts: [concept("canonical", { name: "归纳偏好" }), concept("unrelated")], stages: [stage("stage-canonical", { title: "解释偏好" })],
    chats: [chat("root", [{ id: "q", role: "user", content: "归纳偏好与泛化有什么关系？" }, { id: "m", role: "assistant", content: "解释" }])],
  }));
  const proposal = { concepts: [concept("alias", { name: "归纳偏好" }), concept("new")], stages: [stage("stage-alias", { title: "解释偏好" })], warnings: [] };
  const update = createProjectUpdate(initial, proposal);
  const result = addProposalNodes(update.project, "root", "m", proposal, update.receipt);
  assert.equal(result.paperTree.nodes.filter((item) => item.kind === "graph").length, 1);
  assert.equal(result.paperTree.nodes.filter((item) => item.kind === "path" && item.role !== "stage").length, 1);
  assert.equal(node(result, "stage:stage-canonical").parentId, "path");
  assert.equal(result.paperTree.nodes.some((item) => item.sourceMessageId === "m"), false);
  assert.deepEqual(result.concepts.map((item) => item.id), ["canonical", "unrelated", "new"]);
  assert.equal(result.activeTab, initial.activeTab);
  assert.equal(result.concepts, update.project.concepts);
  assert.equal(result.stages, update.project.stages);
  assert.equal(result.tabs, initial.tabs);
  assert.equal(addProposalNodes(result, "root", "m", proposal, { concepts: [], stages: [] }), result);
  assert.equal(normalizePaperTree(result), result);
  const afterUndo = normalizePaperTree(revertProjectUpdate(result, update.receipt).project);
  assert.deepEqual(afterUndo.concepts, initial.concepts);
  assert.deepEqual(afterUndo.stages, initial.stages);
  assert.equal(node(afterUndo, "stage:stage-canonical").parentId, "path");
});

test("receipt-only indexing filters deleted IDs and updates only the owning chapter graph", () => {
  const initial = normalizePaperTree(project({ concepts: [concept("one")], stages: [] }));
  const receipt = { concepts: [{ id: "one" }, { id: "deleted" }], stages: [] };
  const proposal = { concepts: [], stages: [], warnings: [] };
  const result = addProposalNodes(initial, "missing-parent", "m", proposal, receipt);
  assert.equal(result, initial);
  assert.equal(addProposalNodes(result, "missing-parent", "m", proposal, receipt), result);
  const chapterProject = normalizePaperTree({ ...initial, sources: [source("book")] });
  const chapter = chapterProject.paperTree.nodes.find((item) => item.role === "chapter");
  const indexed = addProposalNodes(chapterProject, chapter.id, "m", proposal, receipt);
  assert.deepEqual(node(indexed, scopeGraphId(chapter.id)).conceptIds, ["one"]);
  assert.equal(addProposalNodes(indexed, chapter.id, "m", proposal, receipt), indexed);
});

test("titles follow live entities unless explicitly overridden, and ancestors tolerate corrupt input", () => {
  const initial = normalizePaperTree(project({ sources: [source("book")] }));
  assert.equal(nodeTitle(initial, node(initial, "book:book")), "教材 book");
  assert.equal(nodeTitle({ ...initial, sources: [{ ...initial.sources[0], title: "新标题" }] }, node(initial, "book:book")), "新标题");
  assert.equal(nodeTitle(initial, { ...node(initial, "book:book"), title: "我的标题" }), "我的标题");
  assert.deepEqual(paperAncestors(initial, "root"), []);
  assert.deepEqual(paperAncestors(initial, "unknown"), []);
  const corrupt = { paperTree: { nodes: [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }] } };
  assert.deepEqual(paperAncestors(corrupt, "a").map((item) => item.id), ["b"]);
});

test("a paper bound to an editable question resolves its current prompt in the tree", () => {
  const questionPaper = paper("paper:question", "root");
  questionPaper.object = { ...questionPaper.object, kind: "question", id: "question:set:q", title: "旧题目" };
  const current = normalizePaperTree(project({ papers: [questionPaper], sets: [{ id: "set", title: "题目", questions: [{ id: "q", prompt: "编辑后的题目" }] }] }));
  assert.equal(nodeTitle(current, node(current, "paper:question")), "编辑后的题目");
});

test("unknown tree versions are rejected without modifying persisted data", () => {
  const future = frozen(project({ paperTree: { version: 3, rootId: "future", nodes: [] } }));
  assert.throws(() => normalizePaperTree(future), /Unsupported paper tree version: 3/);
  assert.equal(future.paperTree.version, 3);
});

test("v2 uses a virtual root with only the tutor and source files, including default empty global views", () => {
  const before = project({ sources: [source("one"), source("two")], chats: [chat("root"), chat("loose")], paperTree: {
    version: 1, rootId: "root", nodes: [
      { id: "root", kind: "chat", parentId: null, title: "旧项目标题" },
      { id: "book:one", kind: "book", sourceId: "one", parentId: "loose", origin: "import" },
      { id: "loose", kind: "chat", parentId: null },
      { id: "graph", kind: "graph", parentId: "root", title: "旧图谱标题", conceptIds: [] },
    ],
  } });
  const result = normalizePaperTree(frozen(before));
  assert.equal(result.paperTree.version, 2);
  assert.equal(result.paperTree.rootId, "project:project");
  assert.equal(result.paperTree.tutorId, "root");
  assert.equal(node(result, result.paperTree.rootId), undefined);
  assert.deepEqual(result.paperTree.nodes.filter((item) => item.parentId === result.paperTree.rootId).map((item) => item.id), ["root", "book:one", "book:two"]);
  assert.equal(node(result, "loose").parentId, "root");
  assert.equal(node(result, "graph").parentId, "root");
  assert.equal(node(result, "path").parentId, "root");
  assert.equal(node(result, "graph").conceptIds, undefined);
  assert.equal(node(result, "path").stageIds, undefined);
  assert.equal(nodeTitle(result, node(result, "root")), "项目 Tutor");
  assert.equal(nodeTitle(result, node(result, "graph")), "项目知识图谱");
  assert.equal(nodeTitle(result, node(result, "path")), "项目关卡图");
  assert.equal(result.chats, before.chats);
  assert.equal(result.tabs, before.tabs);
  assert.equal(normalizePaperTree(result), result);
});

test("source contexts without a page belong to the source, and source scoped conversations retain hierarchy", () => {
  const book = { ...source("book"), pages: ["第一章", "第二页", "第三页"], outline: [{ title: "第一章", page: 1, level: 1, kind: "chapter" }] };
  const section = sourceSections(book)[0];
  const before = project({ sources: [book], chats: [
    chat("root"),
    chat("no-page", [], { context: { parentId: "root", sourceId: "book" } }),
    chat("with-page", [], { context: { parentId: "root", reading: { sourceId: "book", page: 2, title: "段落" } } }),
    chat("scope", [], { context: { parentId: "root", sourceId: "book", scopeNodeId: section.id } }),
    chat("followup", [], { context: { parentId: "no-page", sourceId: "book" } }),
  ] });
  const result = normalizePaperTree(before);
  assert.equal(node(result, "no-page").parentId, "book:book");
  assert.equal(node(result, "no-page").anchor, undefined);
  assert.equal(node(result, "with-page").parentId, "book:book");
  assert.equal(node(result, "scope").parentId, section.id);
  assert.equal(node(result, "followup").parentId, "no-page");
  assert.equal(normalizePaperTree(result), result);
});

test("chapters keep section hierarchy and independent progress while their graphs accumulate only owned canonical concepts", () => {
  const book = { ...source("book"), pages: ["一", "二", "三", "四", "五", "六"], outline: [
    { title: "第一章", page: 1, level: 1, kind: "chapter" },
    { title: "1.1 基础", page: 2, level: 2, kind: "section" },
    { title: "第二章", page: 4, level: 1, kind: "chapter" },
  ] };
  const sections = sourceSections(book);
  let current = normalizePaperTree(project({ sources: [book], concepts: [concept("old"), concept("canonical", { name: "同名概念" })] }));
  assert.equal(node(current, sections[1].id).parentId, sections[0].id);
  assert.equal(node(current, sections[1].id).endPage, 3);
  assert.equal(node(current, sections[0].id).role, "chapter");
  assert.equal(node(current, "book:book").role, "source");
  current = { ...current, paperTree: { ...current.paperTree, nodes: current.paperTree.nodes.map((item) => item.id === sections[0].id ? { ...item, progress: 2 } : item) } };
  current = ensureScopeGraph(current, sections[0].id);
  current = ensureScopeGraph(current, sections[2].id);
  assert.deepEqual(node(current, scopeGraphId(sections[0].id)).conceptIds, []);
  assert.deepEqual(node(current, scopeGraphId(sections[2].id)).conceptIds, []);
  assert.equal(node(current, sections[0].id).progress, 2);
  assert.equal(ensureScopeGraph(current, sections[0].id), current);
  assert.equal(ensureScopeGraph(current, current.paperTree.tutorId), current);
  current = attachPaperNode(current, { id: "chapter-chat", kind: "chat", parentId: sections[0].id, origin: "selection" });
  const proposal = { concepts: [concept("alias", { name: "同名概念" })], stages: [], warnings: [] };
  const update = createProjectUpdate(current, proposal);
  const result = addProposalNodes(update.project, "chapter-chat", "m", proposal, update.receipt);
  assert.deepEqual(node(result, scopeGraphId(sections[0].id)).conceptIds, ["canonical"]);
  assert.deepEqual(node(result, scopeGraphId(sections[2].id)).conceptIds, []);
  assert.equal(node(result, "graph").conceptIds, undefined);
  assert.equal(result.activeTab, current.activeTab);
  assert.equal(result.concepts, update.project.concepts);
  assert.equal(addProposalNodes(result, "chapter-chat", "m", proposal, update.receipt), result);
  assert.equal(normalizePaperTree(result), result);
});

test("multi-source stages belong to the one project map and only reference their materials", () => {
  const anchors = [{ sourceId: "missing", page: 1, title: "旧资料" }, { sourceId: "first", page: 1, title: "第一本" }, { sourceId: "second", page: 1, title: "第二本" }];
  const sharedStage = stage("shared", { title: "比较两本书", anchors });
  let current = normalizePaperTree(project({ sources: [source("first"), source("second")], stages: [sharedStage, stage("unanchored")] }));
  assert.equal(current.paperTree.nodes.filter((item) => item.role === "stage" && item.stageId === "shared").length, 1);
  assert.equal(node(current, "stage:shared").parentId, "path");
  assert.equal(node(current, "stage:shared").sourceId, "first");
  assert.deepEqual(node(current, "stage:shared").stageIds, ["shared"]);
  assert.equal(node(current, "stage:unanchored").parentId, "path");
  assert.equal(ensureScopeGraph(current, "stage:shared"), current);
  assert.equal(node(current, scopeGraphId("stage:shared")), undefined);
  assert.equal(nodeTitle(current, node(current, "stage:shared")), "比较两本书");
  assert.equal(current.stages[0], sharedStage);
  const afterSourceRemoval = normalizePaperTree({ ...current, sources: current.sources.filter((item) => item.id !== "first") });
  assert.equal(node(afterSourceRemoval, "stage:shared").parentId, "path");
  assert.equal(node(afterSourceRemoval, "stage:shared").sourceId, "second");
  assert.equal(afterSourceRemoval.stages, current.stages);
  assert.equal(normalizePaperTree(afterSourceRemoval), afterSourceRemoval);
});

test("legacy stage graphs and result views retain identity, descendants, edits and receipts as history", () => {
  const oldGraphId = scopeGraphId("stage:one");
  const receipt = { concepts: [{ id: "kept", after: concept("kept") }], stages: [] };
  const message = { id: "m", role: "assistant", content: "原始讨论", appliedUpdate: receipt };
  let before = normalizePaperTree(project({
    sources: [source("book")], concepts: [concept("kept", { layout: { x: 99, y: 73 } })], stages: [stage("one", { anchors: [{ sourceId: "book", page: 1 }] })],
    chats: [chat("root", [message]), chat("followup")],
  }));
  const oldViews = [
    { id: oldGraphId, kind: "graph", role: "scope-graph", parentId: "stage:one", conceptIds: ["kept"], autoGraph: { status: "ready", fingerprint: "old" } },
    { id: "tool:path:root:m", kind: "path", parentId: "root", stageIds: ["one"], sourceMessageId: "m", title: "我的路线" },
    { id: "tool:graph:root:m", kind: "graph", parentId: "root", conceptIds: ["kept"], sourceMessageId: "m" },
    { id: "manual", kind: "graph", parentId: "tool:graph:root:m", conceptIds: [] },
  ];
  before = { ...before, paperTree: { ...before.paperTree, nodes: [
    ...before.paperTree.nodes.map((item) => item.id === "stage:one" ? { ...item, parentId: "book:book" } : item.id === "followup" ? { ...item, parentId: oldGraphId } : item),
    ...oldViews,
  ] }, tabs: [{ id: oldGraphId, kind: "graph" }], activeTab: oldGraphId };
  const result = normalizePaperTree(frozen(before));
  assert.equal(node(result, "stage:one").parentId, "path");
  for (const old of oldViews) {
    const retained = node(result, old.id);
    assert.equal(retained.role, "history");
    for (const field of ["kind", "parentId", "conceptIds", "stageIds", "sourceMessageId", "autoGraph"]) assert.deepEqual(retained[field], old[field]);
  }
  assert.equal(nodeTitle(result, node(result, oldGraphId)), "关卡知识记录");
  assert.equal(nodeTitle(result, node(result, "tool:path:root:m")), "我的路线");
  assert.equal(nodeTitle(result, node(result, "tool:graph:root:m")), "知识记录");
  assert.equal(node(result, "followup").parentId, oldGraphId);
  assert.equal(result.activeTab, oldGraphId);
  for (const field of ["concepts", "stages", "chats", "tabs"]) assert.equal(result[field], before[field]);
  assert.equal(normalizePaperTree(result), result);
});

test("empty legacy stage graphs stay addressable and route-only proposals never create a chapter map or graph", () => {
  let before = normalizePaperTree(project({ sources: [source("book")], stages: [stage("one")] }));
  const oldGraphId = scopeGraphId("stage:one");
  before = { ...before, paperTree: { ...before.paperTree, nodes: [...before.paperTree.nodes,
    { id: oldGraphId, kind: "graph", role: "scope-graph", parentId: "stage:one", conceptIds: [] },
  ] } };
  const retained = normalizePaperTree(before);
  assert.equal(node(retained, oldGraphId).role, "history");
  assert.deepEqual(node(retained, oldGraphId).conceptIds, []);
  assert.equal(ensureScopeGraph(retained, "stage:one"), retained);
  const chapter = retained.paperTree.nodes.find((item) => item.role === "chapter");
  const proposal = { concepts: [], stages: [stage("new")], warnings: [] };
  const update = createProjectUpdate(retained, proposal);
  const applied = addProposalNodes(update.project, chapter.id, "route-message", proposal, update.receipt);
  assert.equal(node(applied, "stage:new").parentId, "path");
  assert.equal(node(applied, scopeGraphId(chapter.id)), undefined);
  assert.equal(applied.paperTree.nodes.filter((item) => item.kind === "path" && item.role !== "stage").length, 1);
  const undone = normalizePaperTree(revertProjectUpdate(applied, update.receipt).project);
  assert.equal(node(undone, "stage:new"), undefined);
  assert.equal(node(undone, oldGraphId), node(retained, oldGraphId));
});

test("bookmark removal promotes its children to the source, while deleting the source promotes descendants to tutor", () => {
  const bookmark = { id: "mark", sourceId: "book", page: 1, title: "我的书签", quote: "记住这段解释", created: "2026-09-23" };
  const initial = normalizePaperTree(project({ sources: [source("book")], bookmarks: [bookmark] }));
  let current = attachPaperNode(initial, { id: "bookmark-chat", kind: "chat", parentId: "bookmark:mark", origin: "selection" });
  const chapter = current.paperTree.nodes.find((item) => item.role === "chapter");
  current = ensureScopeGraph(current, chapter.id);
  assert.equal(node(current, "bookmark:mark").parentId, "book:book");
  assert.equal(nodeTitle(current, node(current, "bookmark:mark")), "记住这段解释");
  const removedMark = normalizePaperTree({ ...current, bookmarks: [] });
  assert.equal(node(removedMark, "bookmark:mark"), undefined);
  assert.equal(node(removedMark, "bookmark-chat").parentId, "book:book");
  assert.equal(normalizePaperTree(removedMark), removedMark);
  const removedSource = normalizePaperTree({ ...current, sources: [] });
  assert.equal(removedSource.paperTree.nodes.some((item) => item.kind === "book"), false);
  assert.equal(node(removedSource, "bookmark-chat").parentId, "root");
  assert.equal(node(removedSource, scopeGraphId(chapter.id)).parentId, "root");
  assert.equal(normalizePaperTree(removedSource), removedSource);
});

test("outline refresh retains chapters with real descendants and prunes empty stale subtrees in one pass", () => {
  const book = { ...source("book"), pages: ["甲", "乙", "丙", "丁"], outline: [
    { title: "旧第一章", page: 1, level: 1, kind: "chapter" },
    { title: "旧子节", page: 2, level: 2, kind: "section" },
  ] };
  const initial = normalizePaperTree(project({ sources: [book] }));
  const chapters = initial.paperTree.nodes.filter((item) => item.role === "chapter");
  const updatedBook = { ...book, outline: [{ title: "修正目录", page: 3, level: 1, kind: "chapter" }] };
  const emptyRefresh = normalizePaperTree({ ...initial, sources: [updatedBook] });
  assert.equal(node(emptyRefresh, chapters[0].id), undefined);
  assert.equal(node(emptyRefresh, chapters[1].id), undefined);
  assert.equal(normalizePaperTree(emptyRefresh), emptyRefresh);
  const withGraph = ensureScopeGraph(initial, chapters[1].id);
  const retained = normalizePaperTree({ ...withGraph, sources: [updatedBook] });
  assert.ok(node(retained, chapters[0].id));
  assert.ok(node(retained, chapters[1].id));
  assert.equal(node(retained, scopeGraphId(chapters[1].id)).parentId, chapters[1].id);
  assert.equal(normalizePaperTree(retained), retained);
});
