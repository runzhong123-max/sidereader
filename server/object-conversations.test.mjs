import test from "node:test";
import assert from "node:assert/strict";
import { attachPaperNode, ensureScopeGraph, normalizePaperTree, scopeGraphId } from "../src/paper-tree-state.mjs";
import { conversationNodes, conversationOwner, conversationRoot, projectNavigationNodes } from "../src/conversation-model.mjs";
import { conversationForScope, ensureObjectConversation, ensureScopeConversation, objectConversationContext, scopeConversation } from "../src/object-conversations.mjs";

const chapter = "s@1:1", otherChapter = "s@6:1";
function fixture() {
  return normalizePaperTree({
    id: "p", name: "学习", chats: [{ id: "tutor", title: "项目 Tutor", messages: [] }],
    sources: [{ id: "s", title: "教材", pages: Array(10).fill("原文"), chunks: [], outline: [
      { title: "第一章", page: 1, endPage: 5, level: 1 }, { title: "第二章", page: 6, endPage: 10, level: 1 },
    ] }],
    concepts: [{ id: "a", name: "先验", description: "观察之前的信念", links: ["b"] }, { id: "b", name: "后验", description: "观察之后的信念", links: [] }],
    sets: [{ id: "quiz", title: "本章检查", scopeNodeId: chapter, questions: [{
      id: "q", type: "choice", prompt: "哪一个是先验？", options: ["选项一", "选项二"], answer: "秘密答案", explanation: "秘密解析", hint: "先思考时间顺序",
    }] }],
    stages: [], papers: [], tabs: [{ id: "tutor", kind: "chat" }], activeTab: "tutor",
  });
}

const chat = (project, id) => project.chats.find((item) => item.id === id);
const node = (project, id) => project.paperTree.nodes.find((item) => item.id === id);
const question = (id) => ({ id, role: "user", content: "继续讨论" });
function addConversation(project, id, { scope = chapter, parentId = scope, conversationRoot = true, messages = [], created, lastInteractionAt } = {}) {
  return attachPaperNode({
    ...project,
    chats: [...project.chats, { id, title: id, messages, lastInteractionAt, context: { parentId, scopeNodeId: scope } }],
  }, { id, kind: "chat", parentId, conversationRoot, created });
}

test("opening chapter projections and object contexts does not create conversations", () => {
  const project = ensureScopeGraph(fixture(), chapter), before = structuredClone(project);
  const first = scopeConversation(project, chapter), repeated = scopeConversation(project, chapter);
  assert.equal(first.node.id, `scope-chat:${encodeURIComponent(chapter)}`);
  assert.deepEqual(first, repeated);
  assert.deepEqual(first.chat.messages, []);
  assert.equal(first.chat.context.scopeNodeId, chapter);
  assert.equal(conversationForScope(project, chapter), undefined);
  objectConversationContext(project, scopeGraphId(chapter));
  objectConversationContext(project, "questions:quiz");
  assert.deepEqual(project, before);
  assert.equal(project.chats.length, 1);
});

test("first chapter ask persists the virtual conversation and repeated asks reuse it", () => {
  const project = fixture(), view = scopeConversation(project, chapter);
  const created = ensureScopeConversation(project, chapter);
  assert.equal(created.nodeId, view.node.id);
  assert.deepEqual(chat(created.project, created.nodeId), view.chat);
  assert.equal(node(created.project, created.nodeId).parentId, chapter);
  assert.equal(conversationOwner(created.project, created.nodeId).id, chapter);
  const reused = ensureScopeConversation(created.project, chapter);
  assert.strictEqual(reused.project, created.project);
  assert.equal(reused.nodeId, created.nodeId);
  assert.equal(created.project.activeTab, project.activeTab);
});

test("project and whole-PDF scopes share the existing project Tutor", () => {
  const project = fixture();
  for (const id of [project.id, project.paperTree.rootId, "book:s", "tutor"]) {
    assert.equal(conversationForScope(project, id).id, "tutor");
    assert.equal(scopeConversation(project, id).node.id, "tutor");
    assert.strictEqual(ensureScopeConversation(project, id).project, project);
  }
});

test("same-scope references prefer the active paper, reject other chapters, and preserve main-chat history", () => {
  const first = ensureScopeConversation(fixture(), chapter), second = ensureScopeConversation(first.project, otherChapter);
  const message = { id: "m", role: "user", content: "已有提问" };
  const stored = {
    ...second.project,
    chats: second.project.chats.map((item) => item.id === first.nodeId ? { ...item, messages: [message] } : item),
  };
  const branch = { id: "branch", kind: "chat", parentId: first.nodeId, conversationRoot: false };
  const project = attachPaperNode({ ...stored, chats: [...stored.chats, { id: "branch", title: "追问", messages: [], context: { parentId: first.nodeId, scopeNodeId: chapter } }] }, branch);
  assert.equal(conversationForScope(project, chapter, "branch").id, "branch");
  assert.equal(conversationForScope(project, chapter, second.nodeId).id, first.nodeId);
  assert.equal(conversationForScope(project, otherChapter, first.nodeId).id, second.nodeId);
  const reused = ensureScopeConversation(project, chapter);
  assert.strictEqual(reused.project, project);
  assert.strictEqual(chat(reused.project, first.nodeId).messages[0], message);
});

test("PDF questions resume the last interacted main chat, independently of creation or saved array order", () => {
  let project = addConversation(fixture(), "recent", {
    messages: [question("recent-question")], created: "2026-09-01T08:00:00Z", lastInteractionAt: "2026-09-28T10:00:00Z",
  });
  project = addConversation(project, "older", {
    messages: [question("older-question")], created: "2026-09-20T08:00:00Z", lastInteractionAt: "2026-09-27T10:00:00Z",
  });
  project = addConversation(project, "empty", { created: "2026-09-29T08:00:00Z" });
  project = addConversation(project, "other-chapter", {
    scope: otherChapter, messages: [question("elsewhere")], lastInteractionAt: "2026-09-30T10:00:00Z",
  });
  const before = structuredClone(project);
  for (const current of [project, { ...project, chats: [...project.chats].reverse(), paperTree: { ...project.paperTree, nodes: [...project.paperTree.nodes].reverse() } }]) {
    assert.equal(scopeConversation(current, chapter).node.id, "recent");
    assert.equal(conversationForScope(current, chapter, "other-chapter").id, "recent");
    assert.equal(conversationForScope(current, chapter, "older").id, "older", "an explicit current conversation wins over recency");
    assert.equal(conversationForScope(current, chapter, "empty").id, "empty", "an explicitly selected empty conversation is retained");
  }
  assert.deepEqual(project, before);
});

test("recent branch interaction resumes its main conversation without choosing an unrelated or object conversation", () => {
  let project = addConversation(fixture(), "main", { messages: [question("main-question")], lastInteractionAt: "2026-09-01T10:00:00Z" });
  project = addConversation(project, "other-main", { messages: [question("other-question")], lastInteractionAt: "2026-09-20T10:00:00Z" });
  project = addConversation(project, "followup", {
    parentId: "main", conversationRoot: false, messages: [question("followup-question")], lastInteractionAt: "2026-09-28T10:00:00Z",
  });
  const object = ensureObjectConversation(ensureScopeGraph(project, chapter), scopeGraphId(chapter));
  project = {
    ...object.project,
    chats: object.project.chats.map((item) => item.id === object.nodeId ? { ...item, messages: [question("object-question")], lastInteractionAt: "2026-09-30T10:00:00Z" } : item),
  };
  assert.equal(conversationForScope(project, chapter).id, "main");
  assert.equal(conversationForScope(project, chapter, object.nodeId).id, "main");
  assert.equal(conversationForScope(project, chapter, "followup").id, "followup");
});

test("legacy conversations use valid creation times without letting empty chats displace prior interaction", () => {
  let project = addConversation(fixture(), "legacy-old", { messages: [question("old")], created: "2026-09-01T08:00:00Z" });
  project = addConversation(project, "legacy-recent", { messages: [question("recent")], created: "2026-09-20T08:00:00Z", lastInteractionAt: "invalid" });
  project = addConversation(project, "empty", { created: "2026-09-29T08:00:00Z", lastInteractionAt: "2026-09-29T08:00:00Z" });
  assert.equal(conversationForScope(project, chapter).id, "legacy-recent");
  const undated = {
    ...project,
    paperTree: { ...project.paperTree, nodes: project.paperTree.nodes.map((item) => ({ ...item, created: undefined })) },
  };
  assert.equal(conversationForScope(undated, chapter).id,
    conversationForScope({ ...undated, paperTree: { ...undated.paperTree, nodes: [...undated.paperTree.nodes].reverse() } }, chapter).id);
});

test("project Tutor remains the empty-scope default and participates in recent project conversations", () => {
  let project = addConversation(fixture(), "project-empty", { scope: "tutor", created: "2026-09-29T08:00:00Z" });
  assert.equal(conversationForScope(project, "book:s").id, "tutor");
  project = addConversation(project, "project-recent", { scope: "tutor", messages: [question("project-question")], lastInteractionAt: "2026-09-28T10:00:00Z" });
  assert.equal(conversationForScope(project, "book:s").id, "project-recent");
  assert.equal(conversationForScope(project, "book:s", "tutor").id, "tutor");
  project = { ...project, chats: project.chats.map((item) => item.id === "tutor" ? {
    ...item, messages: [question("tutor-question")], lastInteractionAt: "2026-09-29T10:00:00Z",
  } : item) };
  assert.equal(conversationForScope(project, "book:s").id, "tutor");
});

test("object follow-up lazily creates one independent conversation with fixed chapter ownership", () => {
  const project = ensureScopeGraph(fixture(), chapter), objectId = scopeGraphId(chapter);
  const created = ensureObjectConversation(project, objectId);
  assert.equal(project.chats.length, 1);
  assert.equal(created.project.chats.length, 2);
  assert.equal(chat(created.project, created.nodeId).context.objectNodeId, objectId);
  assert.equal(chat(created.project, created.nodeId).context.scopeNodeId, chapter);
  assert.equal(node(created.project, created.nodeId).parentId, objectId);
  assert.equal(conversationRoot(created.project, created.nodeId).id, created.nodeId);
  assert.equal(conversationOwner(created.project, created.nodeId).id, chapter);
  const reused = ensureObjectConversation(created.project, objectId);
  assert.equal(reused.nodeId, created.nodeId);
  assert.strictEqual(reused.project, created.project);
  assert.equal(created.project.activeTab, project.activeTab);
});

test("object conversations and their child papers stay out of same-scope main-chat selection", () => {
  const project = ensureScopeGraph(fixture(), chapter), objectId = scopeGraphId(chapter);
  const created = ensureObjectConversation(project, objectId);
  const branch = { id: "object-child", kind: "chat", parentId: created.nodeId, conversationRoot: false };
  const withBranch = attachPaperNode({ ...created.project, chats: [...created.project.chats, { id: branch.id, title: "子纸张", messages: [], context: { parentId: created.nodeId, scopeNodeId: chapter } }] }, branch);
  for (const preferred of [created.nodeId, branch.id]) assert.equal(conversationForScope(withBranch, chapter, preferred), undefined);
  const navigation = projectNavigationNodes(withBranch);
  assert.equal(navigation.some((item) => [created.nodeId, branch.id].includes(item.id)), false);
  assert.deepEqual(conversationNodes(withBranch, created.nodeId).map((item) => item.id), [created.nodeId, branch.id]);
  const main = ensureScopeConversation(withBranch, chapter);
  assert.notEqual(main.nodeId, created.nodeId);
  assert.equal(conversationForScope(main.project, chapter, branch.id).id, main.nodeId);
});

test("graph context preserves the graph's own selected concepts and their visible relations", () => {
  const project = fixture();
  const graph = { id: "snapshot", kind: "graph", parentId: "tutor", title: "刚才的逻辑", conceptIds: ["a", "b"] };
  const withGraph = attachPaperNode(project, graph);
  const context = objectConversationContext(withGraph, graph.id);
  assert.match(context.quote, /先验：观察之前的信念/);
  assert.match(context.quote, /关联：后验/);
  assert.equal(context.scopeNodeId, "tutor");
  const empty = objectConversationContext({ ...withGraph, paperTree: { ...withGraph.paperTree, nodes: withGraph.paperTree.nodes.map((item) => item.id === graph.id ? { ...item, conceptIds: [] } : item) } }, graph.id);
  assert.equal(empty.quote, "");
});

test("question-file context exposes prompts and choices without unsubmitted answers, explanations or hints", () => {
  const project = fixture(), context = objectConversationContext(project, "questions:quiz");
  assert.equal(context.scopeNodeId, chapter);
  assert.match(context.quote, /哪一个是先验？/);
  assert.match(context.quote, /选项一/);
  for (const secret of ["秘密答案", "秘密解析", "先思考时间顺序"]) {
    assert.equal(context.quote.includes(secret), false);
    assert.equal(context.object.content.includes(secret), false);
  }
  const created = ensureObjectConversation(project, "questions:quiz");
  assert.equal(chat(created.project, created.nodeId).context.objectNodeId, "questions:quiz");
});

test("question snapshots resolve the editable question while keeping the visible quote answer-free", () => {
  const project = fixture(), question = project.sets[0].questions[0];
  const paper = {
    id: "question-paper", parentId: chapter, parentTab: node(project, chapter), parentTitle: "第一章", title: "旧题目", evidence: [{ id: "e", text: "原文依据" }], sourceMessageId: "original-answer", created: "saved",
    object: { id: "question:quiz:q", kind: "question", title: "旧题目", content: "秘密答案", question: { ...question, prompt: "旧题干" } },
  };
  const withPaper = attachPaperNode({ ...project, papers: [paper] }, { id: paper.id, kind: "paper", objectId: paper.id, parentId: chapter });
  const context = objectConversationContext(withPaper, paper.id);
  assert.match(context.quote, /哪一个是先验？/);
  assert.equal(context.quote.includes("秘密答案"), false);
  assert.equal(context.object.content, "");
  assert.equal(context.sourceMessageId, "original-answer");
  assert.deepEqual(context.evidence, paper.evidence);
  const created = ensureObjectConversation(withPaper, paper.id);
  assert.equal(chat(created.project, created.nodeId).context.scopeNodeId, chapter);
});

test("existing object follow-up history is adopted without replacing messages or its original quote", () => {
  const project = ensureScopeGraph(fixture(), chapter), objectId = scopeGraphId(chapter);
  const messages = [{ id: "old-message", role: "user", content: "保留我原来的问题" }];
  const legacy = attachPaperNode({ ...project, chats: [...project.chats, { id: "legacy", title: "已有对象问题", messages, context: { parentId: objectId, quote: "原来的范围" } }] }, { id: "legacy", kind: "chat", parentId: objectId });
  assert.equal(conversationForScope(legacy, chapter, "legacy"), undefined);
  const created = ensureObjectConversation(legacy, objectId);
  assert.equal(created.nodeId, "legacy");
  assert.equal(created.project.chats.length, legacy.chats.length);
  assert.strictEqual(chat(created.project, "legacy").messages, messages);
  assert.equal(chat(created.project, "legacy").context.quote, "原来的范围");
  assert.equal(chat(created.project, "legacy").context.objectNodeId, objectId);
  assert.equal(chat(created.project, "legacy").context.scopeNodeId, chapter);
  assert.strictEqual(ensureObjectConversation(created.project, objectId).project, created.project);
});

test("reopening an object conversation refreshes edited content and repairs scope without replacing its history", () => {
  const project = ensureScopeGraph(fixture(), chapter), objectId = scopeGraphId(chapter);
  project.paperTree.nodes.find((item) => item.id === objectId).conceptIds = ["a", "b"];
  const created = ensureObjectConversation(project, objectId);
  const original = chat(created.project, created.nodeId);
  const messages = [{ id: "asked", role: "user", content: "解释先验" }];
  const edited = {
    ...created.project,
    concepts: created.project.concepts.map((concept) => concept.id === "a" ? { ...concept, description: "修订后的概念解释" } : concept),
    chats: created.project.chats.map((item) => item.id === created.nodeId ? {
      ...item, messages, context: { ...item.context, scopeNodeId: otherChapter },
    } : item),
  };
  const reopened = ensureObjectConversation(edited, objectId);
  const current = chat(reopened.project, reopened.nodeId);
  assert.equal(reopened.nodeId, created.nodeId);
  assert.equal(reopened.project.chats.length, edited.chats.length);
  assert.strictEqual(current.messages, messages);
  assert.equal(current.context.quote, original.context.quote, "the opening excerpt remains provenance");
  assert.match(current.context.object.content, /修订后的概念解释/);
  assert.equal(current.context.scopeNodeId, chapter);
  assert.strictEqual(ensureObjectConversation(reopened.project, objectId).project, reopened.project);
});

test("invalid objects do not create chats or replace user data", () => {
  const project = fixture();
  for (const id of ["missing", "book:s", chapter, "tutor", "path"]) {
    const result = ensureObjectConversation(project, id);
    assert.strictEqual(result.project, project);
    assert.equal(result.nodeId, undefined);
  }
});
