import test from "node:test";
import assert from "node:assert/strict";
import { revertPaperProposal } from "../src/paper-proposal-undo.mjs";
import { addProposalNodes, attachPaperNode, ensureScopeGraph, normalizePaperTree, scopeGraphId } from "../src/paper-tree-state.mjs";
import { createProjectUpdate } from "../src/project-updates.mjs";

const concept = (id, patch = {}) => ({ id, name: id, description: id, x: 10, y: 20, group: 0, links: [], ...patch });
const stage = (id, patch = {}) => ({ id, title: id, description: id, tag: "练习", done: false, prerequisites: [], ...patch });
const proposal = (concepts = [], stages = []) => ({ concepts, stages, warnings: [] });
function project() {
  return normalizePaperTree({
    id: "project", sources: [], concepts: [], stages: [], sets: [], papers: [],
    chats: [{ id: "root", title: "主对话", messages: [] }],
    tabs: [{ id: "root", kind: "chat" }], activeTab: "root",
  });
}
function apply(project, messageId, proposal, parentId = "root") {
  const parent = project.paperTree.nodes.find((node) => node.id === parentId);
  const chatId = parent?.kind === "chat" ? parent.objectId || parent.id : parentId;
  const message = { id: messageId, role: "assistant", content: "已应用的回答", proposal, proposalApplied: true };
  const chats = project.chats.some((chat) => chat.id === chatId)
    ? project.chats.map((chat) => chat.id === chatId ? { ...chat, messages: [...chat.messages, message] } : chat)
    : [...project.chats, { id: chatId, title: "讨论", messages: [message] }];
  const update = createProjectUpdate({ ...project, chats }, proposal);
  return { project: addProposalNodes(update.project, parentId, messageId, proposal, update.receipt), receipt: update.receipt };
}
function frozen(value) {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
}

test("a later no-op paper proposal protects its canonical concept when the creating proposal is undone", () => {
  const first = apply(project(), "A", proposal([concept("a"), concept("independent")]));
  const second = apply(first.project, "B", proposal([concept("alias", { name: "a", description: "a" })]));
  assert.deepEqual(second.receipt, { concepts: [], stages: [] });
  assert.deepEqual(second.project.chats[0].messages.find((message) => message.id === "B").proposalReferences.concepts, ["a"]);
  assert.equal(second.project.paperTree.nodes.some((node) => node.sourceMessageId === "B"), false);
  const before = frozen(second.project);
  const receipt = frozen(first.receipt);
  const result = revertPaperProposal(before, receipt, "root", "A");
  assert.deepEqual(result.project.concepts.map((item) => item.id), ["a"]);
  assert.equal(result.retained, 1);
  assert.equal(result.project.paperTree, before.paperTree);
  assert.equal(result.project.chats, before.chats);
  assert.equal(result.project.tabs, before.tabs);
  assert.equal(result.project.activeTab, before.activeTab);
});

test("shared stages and their prerequisites survive while unrelated stages are reverted", () => {
  const first = apply(project(), "A", proposal([], [stage("prerequisite"), stage("shared", { prerequisites: ["prerequisite"] }), stage("independent")]));
  const second = apply(first.project, "B", proposal([], [stage("shared", { prerequisites: ["prerequisite"] })]));
  assert.deepEqual(second.receipt, { concepts: [], stages: [] });
  const result = revertPaperProposal(second.project, first.receipt, "root", "A");
  assert.deepEqual(result.project.stages.map((item) => item.id), ["prerequisite", "shared"]);
  assert.equal(result.retained, 2);
});

test("a proposal's own subsets and legacy global views do not prevent undo, and child papers stay attached", () => {
  const first = apply(project(), "A", proposal([concept("a")], [stage("one")]));
  const parent = first.project.paperTree.nodes.find((node) => node.kind === "graph").id;
  let current = attachPaperNode(first.project, { id: "child", kind: "chat", parentId: parent, origin: "selection" });
  current = attachPaperNode(current, { id: "graph", kind: "graph", parentId: "root", origin: "legacy" });
  current = attachPaperNode(current, { id: "path", kind: "path", parentId: "root", origin: "legacy" });
  const result = revertPaperProposal(current, first.receipt, "root", "A");
  assert.deepEqual(result.project.concepts, []);
  assert.deepEqual(result.project.stages, []);
  assert.equal(result.retained, 0);
  assert.equal(result.project.paperTree, current.paperTree);
  assert.equal(result.project.paperTree.nodes.find((node) => node.id === "child").parentId, parent);
});

test("existing later-edit protection still counts once alongside a separate paper-owned entity", () => {
  const first = apply(project(), "A", proposal([concept("shared"), concept("edited"), concept("unreferenced")]));
  const second = apply(first.project, "B", proposal([concept("shared")]));
  const edited = { ...second.project, concepts: second.project.concepts.map((item) => item.id === "edited" || item.id === "shared" ? { ...item, description: "我的修改" } : item) };
  const result = revertPaperProposal(edited, first.receipt, "root", "A");
  assert.deepEqual(result.project.concepts.map((item) => item.id), ["shared", "edited"]);
  assert.equal(result.retained, 2);
  assert.ok(result.project.concepts.every((item) => item.description === "我的修改"));
});

test("the same message ID in another parent is an independent reference, but missing entities do not inflate retained counts", () => {
  const first = apply(project(), "A", proposal([concept("a"), concept("gone")]));
  const withParent = attachPaperNode(first.project, { id: "other", kind: "chat", parentId: "root", origin: "manual" });
  const second = apply(withParent, "A", proposal([concept("a"), concept("gone")]), "other");
  const current = { ...second.project, concepts: second.project.concepts.filter((item) => item.id !== "gone") };
  const result = revertPaperProposal(current, first.receipt, "root", "A");
  assert.deepEqual(result.project.concepts.map((item) => item.id), ["a"]);
  assert.equal(result.retained, 1);
});

test("a shared changed existing object retains the version used by another result", () => {
  const base = { ...project(), concepts: [concept("a")] };
  const first = apply(base, "A", proposal([concept("a", { description: "经核对后的定义" })]));
  const second = apply(first.project, "B", proposal([concept("a", { description: "经核对后的定义" })]));
  const result = revertPaperProposal(second.project, first.receipt, "root", "A");
  assert.equal(result.project.concepts[0].description, "经核对后的定义");
  assert.equal(result.retained, 1);
});

test("derived stage navigation and scope aggregation do not prevent undoing their generating proposal", () => {
  let initial = normalizePaperTree({ ...project(), sources: [{ id: "book", title: "教材", pages: ["第一段"], progress: 1 }] });
  const chapter = initial.paperTree.nodes.find((node) => node.role === "chapter");
  initial = ensureScopeGraph(initial, chapter.id);
  const first = apply(initial, "A", proposal([concept("owned")], [stage("new-stage")]), chapter.id);
  assert.deepEqual(first.project.paperTree.nodes.find((node) => node.id === scopeGraphId(chapter.id)).conceptIds, ["owned"]);
  assert.ok(first.project.paperTree.nodes.some((node) => node.role === "stage" && node.stageId === "new-stage"));
  const result = revertPaperProposal(first.project, first.receipt, chapter.id, "A");
  assert.deepEqual(result.project.concepts, []);
  assert.deepEqual(result.project.stages, []);
  assert.equal(result.retained, 0);
  assert.equal(result.project.paperTree, first.project.paperTree);
});

test("manual result graphs still protect shared entities while derived scope graphs do not", () => {
  const first = apply(project(), "A", proposal([concept("shared"), concept("derived-only")]));
  let current = attachPaperNode(first.project, { id: "manual", kind: "graph", parentId: "root", origin: "manual", conceptIds: ["shared"] });
  current = normalizePaperTree({ ...current, sources: [{ id: "book", title: "教材", pages: ["正文"], progress: 1 }] });
  const chapter = current.paperTree.nodes.find((node) => node.role === "chapter");
  current = ensureScopeGraph(current, chapter.id);
  current = { ...current, paperTree: { ...current.paperTree, nodes: current.paperTree.nodes.map((node) => node.id === scopeGraphId(chapter.id) ? { ...node, conceptIds: ["derived-only"] } : node) } };
  const result = revertPaperProposal(current, first.receipt, "root", "A");
  assert.deepEqual(result.project.concepts.map((item) => item.id), ["shared"]);
  assert.equal(result.retained, 1);
});

test("saved canonical references survive renaming after an alias-only no-op proposal", () => {
  const first = apply({ ...project(), concepts: [concept("a", { name: "原名", description: "旧定义" })] }, "A", proposal([concept("a", { name: "原名", description: "新定义" })]));
  const second = apply(first.project, "B", proposal([concept("alias", { name: "原名", description: "新定义" })]));
  const renamed = { ...second.project, concepts: second.project.concepts.map((item) => ({ ...item, name: "已改名" })) };
  const result = revertPaperProposal(renamed, first.receipt, "root", "A");
  assert.equal(result.project.concepts[0].description, "新定义");
  assert.equal(result.retained, 1);
});

test("unapplied and reverted messages do not protect entities while legacy applied messages recover references", () => {
  const first = apply(project(), "A", proposal([concept("a"), concept("b"), concept("c")]));
  const current = { ...first.project, chats: first.project.chats.map((chat) => ({ ...chat, messages: [...chat.messages,
    { id: "unapplied", proposal: proposal([concept("a")]) },
    { id: "reverted", proposalApplied: false, proposalReferences: { concepts: ["b"], stages: [] } },
    { id: "old-applied", proposalApplied: true, proposal: proposal([concept("alias", { name: "c" })]) },
  ] })) };
  const result = revertPaperProposal(current, first.receipt, "root", "A");
  assert.deepEqual(result.project.concepts.map((item) => item.id), ["c"]);
  assert.equal(result.retained, 1);
});

test("historical stage graphs protect saved knowledge references after stage ownership changes", () => {
  const first = apply(project(), "A", proposal([concept("shared"), concept("unshared")], [stage("one")]));
  const current = attachPaperNode(first.project, { id: scopeGraphId("stage:one"), kind: "graph", role: "scope-graph", parentId: "stage:one", conceptIds: ["shared"] });
  assert.equal(current.paperTree.nodes.find((node) => node.id === scopeGraphId("stage:one")).role, "history");
  const result = revertPaperProposal(current, first.receipt, "root", "A");
  assert.deepEqual(result.project.concepts.map((item) => item.id), ["shared"]);
  assert.deepEqual(result.project.stages, []);
  assert.equal(result.retained, 1);
});
