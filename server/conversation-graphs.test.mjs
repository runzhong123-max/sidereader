import test from "node:test";
import assert from "node:assert/strict";
import { attachPaperNode, normalizePaperTree } from "../src/paper-tree-state.mjs";
import { capturePaperResults, restoreProposalBranches } from "../src/paper-results.mjs";
import { conversationGraphNodeId, restoreConversationGraphs } from "../src/conversation-graphs.mjs";
import { surfaceContent } from "../src/domain/learning-surface.mjs";
import { ensureObjectConversation, objectConversationContext } from "../src/object-conversations.mjs";
import { conversationOwner, projectNavigationNodes } from "../src/conversation-model.mjs";

function fixture() {
  const project = normalizePaperTree({ id: "p", name: "学习", sources: [{ id: "s", title: "教材", pages: Array(5).fill("原文"), chunks: [], outline: [{ title: "第一章", page: 1, level: 1 }] }],
    concepts: [{ id: "global", name: "教材概念", description: "全局原文图谱", links: [] }],
    stages: [], sets: [], chats: [{ id: "tutor", title: "Tutor", messages: [] }], tabs: [{ id: "tutor", kind: "chat" }], activeTab: "tutor" });
  return attachPaperNode({ ...project, chats: [...project.chats, { id: "chapter-chat", title: "章节问题", messages: [], context: { parentId: "s@1:1", scopeNodeId: "s@1:1" } }] }, { id: "chapter-chat", kind: "chat", parentId: "s@1:1", conversationRoot: true });
}
const graph = () => ({ id: "g", title: "刚才对话的逻辑", concepts: [
  { id: "g:a", name: "问题", description: "用户要解决的问题", links: ["g:b"], x: 0, y: 0, group: 0 },
  { id: "g:b", name: "验证", description: "检查我们的解释", links: [], x: 1, y: 1, group: 0 },
] });
const message = () => ({ id: "answer", role: "assistant", content: "这是刚才的逻辑。", conversationGraphs: [graph()] });

test("dynamic graphs become addressable cards in the originating conversation without touching canonical concepts", () => {
  const initial = fixture(), result = capturePaperResults(initial, "chapter-chat", [message()]);
  const id = conversationGraphNodeId("chapter-chat", "g"), local = result.paperTree.nodes.find((node) => node.id === id);
  assert.equal(local.parentId, "chapter-chat");
  assert.equal(local.sourceMessageId, "answer");
  assert.equal(local.objectId, "g");
  assert.deepEqual(local.graphConcepts, graph().concepts);
  assert.strictEqual(result.concepts, initial.concepts);
  assert.equal(result.chats.length, initial.chats.length);
  assert.equal(result.activeTab, initial.activeTab);
  assert.deepEqual(result.tabs, initial.tabs);
  assert.equal(projectNavigationNodes(result).some((node) => node.id === id), false);
  assert.equal(conversationOwner(result, id).id, "s@1:1");
  assert.strictEqual(capturePaperResults(result, "chapter-chat", [message()]), result);
});

test("all presentations and object follow-up use local concepts, including an explicitly empty local graph", () => {
  const result = capturePaperResults(fixture(), "chapter-chat", [message()]);
  const id = conversationGraphNodeId("chapter-chat", "g"), target = { id, kind: "graph" };
  assert.deepEqual(surfaceContent(result, target).concepts, graph().concepts);
  const context = objectConversationContext(result, id);
  assert.match(context.quote, /用户要解决的问题/);
  assert.doesNotMatch(context.quote, /教材概念/);
  assert.equal(context.scopeNodeId, "s@1:1");
  const asked = ensureObjectConversation(result, id);
  assert.equal(conversationOwner(asked.project, asked.nodeId).id, "s@1:1");
  const emptied = { ...result, paperTree: { ...result.paperTree, nodes: result.paperTree.nodes.map((node) => node.id === id ? { ...node, graphConcepts: [] } : node) } };
  assert.deepEqual(surfaceContent(emptied, target).concepts, []);
  assert.equal(objectConversationContext(emptied, id).quote, "");
});

test("restoring graph cards preserves later local edits and does not replace the saved message snapshot", () => {
  const initial = fixture(), savedMessage = message();
  const saved = { ...initial, chats: initial.chats.map((chat) => chat.id === "chapter-chat" ? { ...chat, messages: [savedMessage] } : chat) };
  const restored = restoreProposalBranches(saved), id = conversationGraphNodeId("chapter-chat", "g");
  const edited = { ...restored, paperTree: { ...restored.paperTree, nodes: restored.paperTree.nodes.map((node) => node.id === id ? { ...node, graphConcepts: node.graphConcepts.map((concept) => ({ ...concept, name: "后续手动修改" })) } : node) } };
  assert.strictEqual(restoreConversationGraphs(edited), edited);
  assert.equal(edited.chats.find((chat) => chat.id === "chapter-chat").messages[0].conversationGraphs[0].concepts[0].name, "问题");
  assert.equal(surfaceContent(edited, { id, kind: "graph" }).concepts[0].name, "后续手动修改");
});

test("failed, empty, and unsupported-origin graph results never create empty cards", () => {
  const initial = fixture();
  assert.strictEqual(capturePaperResults(initial, "missing", [message()]), initial);
  assert.strictEqual(capturePaperResults(initial, "chapter-chat", [{ ...message(), error: true }]), initial);
  assert.strictEqual(capturePaperResults(initial, "chapter-chat", [{ ...message(), role: "user" }]), initial);
  assert.strictEqual(capturePaperResults(initial, "chapter-chat", [{ ...message(), conversationGraphs: [{ ...graph(), concepts: [] }] }]), initial);
});
