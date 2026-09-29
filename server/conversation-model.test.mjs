import test from "node:test";
import assert from "node:assert/strict";
import { conversationRoot, conversationOwner, conversationNodes, conversationSummary, conversationQuestionPreview, conversationSearchMatch, conversationResumeTarget, projectNavigationNodes, projectNavigationId, newConversationParent } from "../src/conversation-model.mjs";

function fixture() {
  return {
    id: "p", sources: [{ id: "s", title: "教材", pages: Array(30).fill("text"), progress: 18 }], chats: [
      { id: "tutor", title: "项目 tutor", messages: [] },
      { id: "unlocated", messages: [], context: { parentId: "book:s", sourceId: "s" } },
      { id: "located", messages: [], context: { parentId: "book:s", sourceId: "s", reading: { sourceId: "s", page: 8 } } },
      { id: "fixed", messages: [], context: { parentId: "tutor", sourceId: "s", scopeNodeId: "chapter:2" } },
    ], papers: [{ id: "formula", object: { kind: "formula", content: "x" } }], sets: [], stages: [],
    paperTree: { version: 2, rootId: "project:p", tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: "project:p", origin: "root" },
      { id: "graph", kind: "graph", parentId: "tutor" },
      { id: "path", kind: "path", parentId: "tutor" },
      { id: "questions", kind: "questions", parentId: "tutor" },
      { id: "book:s", kind: "book", role: "source", sourceId: "s", parentId: "project:p" },
      { id: "chapter:1", kind: "book", role: "chapter", sourceId: "s", parentId: "book:s", anchor: { sourceId: "s", page: 2 }, endPage: 12 },
      { id: "chapter:2", kind: "book", role: "chapter", sourceId: "s", parentId: "book:s", anchor: { sourceId: "s", page: 13 }, endPage: 30 },
      { id: "chapter-graph", kind: "graph", role: "scope-graph", parentId: "chapter:1" },
      { id: "bookmark", kind: "book", role: "bookmark", sourceId: "s", parentId: "book:s", anchor: { sourceId: "s", page: 8 } },
      { id: "stage", kind: "path", role: "stage", parentId: "path", anchor: { sourceId: "s", page: 8 } },
      { id: "manual", kind: "chat", parentId: "tutor", origin: "manual" },
      { id: "project-child", kind: "chat", parentId: "manual", sourceMessageId: "answer" },
      { id: "first", kind: "chat", parentId: "chapter:1" },
      { id: "second", kind: "chat", parentId: "chapter:1" },
      { id: "formula", kind: "paper", objectId: "formula", parentId: "first" },
      { id: "formula-followup", kind: "chat", parentId: "formula", sourceMessageId: "answer" },
      { id: "exercise", kind: "questions", parentId: "first" },
      { id: "exercise-followup", kind: "chat", parentId: "exercise" },
      { id: "unlocated", kind: "chat", parentId: "book:s" },
      { id: "located", kind: "chat", parentId: "book:s" },
      { id: "fixed", kind: "chat", parentId: "tutor" },
      { id: "graph-followup", kind: "chat", parentId: "chapter-graph" },
      { id: "old-graph", kind: "graph", role: "history", parentId: "first" },
      { id: "old-graph-followup", kind: "chat", parentId: "old-graph" },
    ] },
  };
}

const byId = (nodes, id) => nodes.find((node) => node.id === id);

test("sidebar preserves PDF chapters and multiple main conversations but hides their branches", () => {
  const p = fixture(), before = structuredClone(p), nodes = projectNavigationNodes(p);
  assert.equal(nodes[0].id, "book:s");
  assert.equal(byId(nodes, "book:s").parentId, "project:p");
  for (const id of ["bookmark", "formula", "exercise", "graph", "path", "questions", "chapter-graph", "stage", "old-graph"])
    assert.equal(byId(nodes, id), undefined);
  for (const id of ["chapter:1", "chapter:2", "unlocated"])
    assert.equal(byId(nodes, id).parentId, "book:s");
  for (const id of ["first", "second", "located"])
    assert.equal(byId(nodes, id).parentId, "chapter:1");
  assert.equal(byId(nodes, "fixed").parentId, "chapter:2");
  for (const id of ["formula-followup", "exercise-followup", "project-child", "old-graph-followup", "graph-followup"])
    assert.equal(byId(nodes, id), undefined);
  assert.deepEqual(conversationNodes(p, "first").map((node) => [node.id, node.parentId]), [
    ["first", null], ["formula-followup", "first"], ["exercise-followup", "first"], ["old-graph-followup", "first"],
  ]);
  for (const id of ["tutor", "manual"]) assert.equal(byId(nodes, id).parentId, "book:s");
  assert.deepEqual(p, before);
});

test("explicit main conversations and legacy tutor roots stay independent of true answer branches", () => {
  const p = fixture();
  p.paperTree.nodes.push(
    { id: "old-independent", kind: "chat", parentId: "first", conversationRoot: true },
    { id: "third", kind: "chat", parentId: "old-independent" },
    { id: "answer", kind: "chat", parentId: "tutor", sourceMessageId: "m" },
    { id: "explicit-tutor-branch", kind: "chat", parentId: "tutor", conversationRoot: false },
  );
  const nodes = projectNavigationNodes(p);
  assert.equal(byId(nodes, "old-independent").parentId, "chapter:1");
  for (const id of ["third", "answer", "explicit-tutor-branch"]) assert.equal(byId(nodes, id), undefined);
  assert.equal(projectNavigationId(p, "third"), "old-independent");
  assert.equal(projectNavigationId(p, "answer"), "tutor");
  assert.deepEqual(conversationNodes(p, "third").map((node) => [node.id, node.parentId]), [["old-independent", null], ["third", "old-independent"]]);
  assert.equal(conversationNodes(p, "first").some((node) => node.id === "old-independent" || node.id === "third"), false);
  assert.deepEqual(conversationNodes(p, "tutor").map((node) => node.id), ["tutor", "answer", "explicit-tutor-branch"]);
  for (const id of ["manual", "fixed"]) assert.equal(nodes.some((node) => node.id === id), true);
});

test("nested PDF sections remain searchable locations with their chapter path and attached conversations", () => {
  const p = fixture();
  p.paperTree.nodes.push(
    { id: "section:1.1", kind: "book", role: "chapter", title: "1.1 现代 Agent", sourceId: "s", parentId: "chapter:1", anchor: { sourceId: "s", page: 3 }, endPage: 8 },
    { id: "section:1.1.1", kind: "book", role: "chapter", title: "1.1.1 观察空间", sourceId: "s", parentId: "section:1.1", anchor: { sourceId: "s", page: 4 }, endPage: 5 },
    { id: "section:1.2", kind: "book", role: "chapter", title: "1.2 工具", sourceId: "s", parentId: "chapter:1", anchor: { sourceId: "s", page: 9 }, endPage: 12 },
    { id: "section-chat", kind: "chat", title: "工具怎样影响观察", parentId: "section:1.1.1" },
    { id: "section-graph", kind: "graph", role: "scope-graph", parentId: "section:1.1.1" },
    { id: "section-graph-followup", kind: "chat", parentId: "section-graph" },
  );
  p.chats.push({ id: "section-chat", context: { scopeNodeId: "chapter:2" } });
  const before = structuredClone(p), nodes = projectNavigationNodes(p);
  assert.deepEqual(nodes.filter((node) => node.parentId === "chapter:1").map((node) => node.id), ["section:1.1", "section:1.2", "first", "second"]);
  assert.equal(byId(nodes, "located").parentId, "section:1.1");
  assert.equal(byId(nodes, "section:1.1.1").parentId, "section:1.1");
  assert.equal(byId(nodes, "section-chat").parentId, "chapter:2", "the fixed conversation scope wins over its former storage parent");
  assert.equal(byId(nodes, "section-graph-followup"), undefined);
  assert.equal(projectNavigationId(p, "section-graph-followup"), "section:1.1.1");
  assert.equal(byId(nodes, "section-graph"), undefined);
  assert.equal(projectNavigationId(p, "section-graph"), "section:1.1.1");
  assert.equal(newConversationParent(p, "section-graph").id, "section:1.1.1");
  // A search match keeps its original path, so the sidebar can reveal all ancestors.
  const match = nodes.find((node) => node.title?.includes("观察空间"));
  const path = []; let current = match;
  while (current) { path.unshift(current.id); current = byId(nodes, current.parentId); }
  assert.deepEqual(path, ["book:s", "chapter:1", "section:1.1", "section:1.1.1"]);
  assert.deepEqual(p, before);
});

test("invalid chapters stay hidden and corrupt outline cycles remain reachable under the PDF", () => {
  const p = fixture();
  p.paperTree.nodes.push(
    { id: "invalid-chapter", kind: "book", role: "chapter", sourceId: "s", parentId: "chapter:1", anchor: { sourceId: "s", page: 99 } },
    { id: "invalid-child", kind: "chat", parentId: "invalid-chapter" },
    { id: "outline-a", kind: "book", role: "chapter", sourceId: "s", parentId: "outline-b", anchor: { sourceId: "s", page: 2 }, endPage: 3 },
    { id: "outline-b", kind: "book", role: "chapter", sourceId: "s", parentId: "outline-a", anchor: { sourceId: "s", page: 2 }, endPage: 3 },
    { id: "outline-leaf", kind: "chat", parentId: "outline-b" },
  );
  const before = structuredClone(p), nodes = projectNavigationNodes(p);
  assert.equal(byId(nodes, "invalid-chapter"), undefined);
  assert.equal(byId(nodes, "invalid-child").parentId, "chapter:1");
  assert.equal(byId(nodes, "outline-a").parentId, "book:s");
  assert.equal(byId(nodes, "outline-b").parentId, "outline-a");
  assert.equal(byId(nodes, "outline-leaf").parentId, "outline-b");
  for (const node of nodes) {
    const seen = new Set(); let current = node;
    while (current) { assert.equal(seen.has(current.id), false); seen.add(current.id); current = byId(nodes, current.parentId); }
  }
  assert.deepEqual(p, before);
});

test("chapters follow PDF page order even when persisted after newer chapters and conversations", () => {
  const p = fixture();
  p.paperTree.nodes.reverse();
  p.paperTree.nodes.push(
    { id: "section-late", kind: "book", role: "chapter", sourceId: "s", parentId: "chapter:1", anchor: { sourceId: "s", page: 10 }, endPage: 12 },
    { id: "preface", kind: "book", role: "chapter", sourceId: "s", parentId: "book:s", anchor: { sourceId: "s", page: 1 }, endPage: 1 },
    { id: "section-early", kind: "book", role: "chapter", sourceId: "s", parentId: "chapter:1", anchor: { sourceId: "s", page: 3 }, endPage: 9 },
  );
  const before = structuredClone(p), nodes = projectNavigationNodes(p);
  assert.deepEqual(nodes.filter((node) => node.parentId === "book:s").map((node) => node.id), ["preface", "chapter:1", "chapter:2", "unlocated", "manual", "tutor"]);
  assert.deepEqual(nodes.filter((node) => node.parentId === "chapter:1").slice(0, 2).map((node) => node.id), ["section-early", "section-late"]);
  assert.deepEqual(p, before);
});

test("selection identifies chapters and main chats while branches and objects reveal their owner", () => {
  const p = fixture();
  for (const id of ["first", "second", "unlocated"])
    assert.equal(projectNavigationId(p, id), id);
  for (const id of ["formula-followup", "exercise-followup", "old-graph-followup", "old-graph"])
    assert.equal(projectNavigationId(p, id), "first");
  assert.equal(projectNavigationId(p, "project-child"), "manual");
  for (const id of ["book:s", "chapter:1", "chapter:2"])
    assert.equal(projectNavigationId(p, id), id);
  assert.equal(projectNavigationId(p, "chapter-graph"), "chapter:1");
  assert.equal(projectNavigationId(p, "bookmark"), "book:s");
  assert.equal(projectNavigationId(p, "formula"), "first");
  assert.equal(projectNavigationId(p, "exercise"), "first");
  for (const id of ["graph", "path", "questions", "stage", "missing"])
    assert.equal(projectNavigationId(p, id), "tutor");
});

test("new papers attach to the actual PDF, chapter or chat while bookmarks remain reading anchors", () => {
  const p = fixture(), before = structuredClone(p);
  for (const id of ["book:s", "chapter:1", "first", "formula-followup"])
    assert.equal(newConversationParent(p, id, { sourceId: "s", page: 18 }).id, id);
  assert.equal(newConversationParent(p, "bookmark").id, "book:s");
  assert.equal(newConversationParent(p, "formula").id, "first");
  assert.equal(newConversationParent(p, "exercise").id, "first");
  assert.equal(newConversationParent(p, "chapter-graph").id, "chapter:1");
  for (const id of ["stage", "graph", "path", "missing"]) assert.equal(newConversationParent(p, id).id, "tutor");
  // Storage parent and chapter scope answer different questions.
  assert.equal(conversationOwner(p, "book:s", { sourceId: "s", page: 18 }).id, "chapter:2");
  assert.equal(newConversationParent(p, "book:s", { sourceId: "s", page: 18 }).id, "book:s");
  assert.deepEqual(p, before);
});

test("fixed scope and reading context select the source without consulting mutable progress", () => {
  const p = fixture();
  assert.equal(conversationOwner(p, "fixed").id, "chapter:2");
  assert.equal(conversationOwner(p, "located").id, "chapter:1");
  assert.equal(conversationOwner(p, "unlocated").id, "tutor");
  const parents = () => projectNavigationNodes(p).map((node) => [node.id, node.parentId]);
  const before = parents();
  p.sources[0].progress = 1;
  assert.deepEqual(parents(), before);
  p.sources.push({ id: "other", pages: Array(20).fill("text") });
  p.paperTree.nodes.push({ id: "book:other", kind: "book", role: "source", sourceId: "other", parentId: "project:p" });
  p.chats.find((chat) => chat.id === "located").context.reading.sourceId = "other";
  assert.equal(byId(projectNavigationNodes(p), "located").parentId, "book:other");
});

test("sidebar ownership follows fixed conversation scope while retaining the saved paper ancestry", () => {
  const p = fixture();
  p.paperTree.nodes.push(
    { id: "moved-scope", kind: "chat", parentId: "chapter:1", conversationRoot: true },
    { id: "whole-project", kind: "chat", parentId: "chapter:1", conversationRoot: true },
    { id: "child-paper", kind: "chat", parentId: "moved-scope", conversationRoot: false },
  );
  p.chats.push(
    { id: "moved-scope", context: { scopeNodeId: "chapter:2", sourceId: "s" } },
    { id: "whole-project", context: { scopeNodeId: "tutor", sourceId: "s" } },
  );
  const before = structuredClone(p), nodes = projectNavigationNodes(p);
  assert.equal(byId(nodes, "moved-scope").parentId, "chapter:2");
  assert.equal(byId(nodes, "whole-project").parentId, "book:s");
  assert.equal(byId(nodes, "child-paper"), undefined);
  assert.equal(projectNavigationId(p, "child-paper"), "moved-scope");
  assert.deepEqual(conversationNodes(p, "moved-scope").map((node) => [node.id, node.parentId]), [["moved-scope", null], ["child-paper", "moved-scope"]]);
  assert.deepEqual(p, before, "read-only scope projection does not migrate the stored conversation tree");
});

test("project conversations use the reading entrance without rewriting their saved source context", () => {
  const p = fixture();
  p.paperTree.nodes.push({ id: "orphan", kind: "chat", parentId: "missing" });
  assert.equal(byId(projectNavigationNodes(p), "orphan").parentId, "book:s");
  assert.equal(p.paperTree.nodes.find((node) => node.id === "orphan").parentId, "missing");
  p.sources = [];
  const nodes = projectNavigationNodes(p);
  assert.equal(nodes.some((node) => node.kind === "book"), false);
  for (const id of ["first", "second", "located", "unlocated", "fixed", "orphan"])
    assert.equal(byId(nodes, id).parentId, "tutor");
  assert.equal(byId(nodes, "formula-followup"), undefined);
  assert.equal(byId(conversationNodes(p, "first"), "formula-followup").parentId, "first");
  assert.equal(projectNavigationId(p, "chapter:1"), "tutor");
});

test("legacy reading aliases keep messages with followups only inside their conversation", () => {
  const p = fixture();
  p.chats.push({ id: "book:s", title: "阅读讨论", messages: [{ role: "user", content: "为什么" }], context: { sourceId: "s" } });
  p.paperTree.nodes.push(
    { id: "discussion:book:s", kind: "chat", objectId: "book:s", parentId: "book:s" },
    { id: "legacy-followup", kind: "chat", parentId: "discussion:book:s", sourceMessageId: "answer" },
  );
  const before = structuredClone(p), nodes = projectNavigationNodes(p);
  assert.equal(byId(nodes, "discussion:book:s").parentId, "book:s");
  assert.equal(byId(nodes, "discussion:book:s").objectId, "book:s");
  assert.equal(byId(nodes, "legacy-followup"), undefined);
  assert.equal(projectNavigationId(p, "legacy-followup"), "discussion:book:s");
  assert.equal(byId(conversationNodes(p, "discussion:book:s"), "legacy-followup").parentId, "discussion:book:s");
  assert.deepEqual(p, before);
});

test("corrupt cycles are broken only in the projection and no conversation is lost", () => {
  const p = fixture();
  p.paperTree.nodes.push(
    { id: "cycle-a", kind: "chat", parentId: "cycle-b" },
    { id: "cycle-b", kind: "chat", parentId: "cycle-a" },
    { id: "cycle-leaf", kind: "chat", parentId: "cycle-b" },
    { id: "self", kind: "chat", parentId: "self" },
  );
  const before = structuredClone(p), nodes = projectNavigationNodes(p);
  assert.equal(byId(nodes, "cycle-a").parentId, "book:s");
  assert.equal(byId(nodes, "cycle-b"), undefined);
  assert.equal(byId(nodes, "cycle-leaf"), undefined);
  assert.equal(byId(nodes, "self").parentId, "book:s");
  const local = conversationNodes(p, "cycle-leaf");
  assert.deepEqual(local.map((node) => [node.id, node.parentId]), [["cycle-a", null], ["cycle-b", "cycle-a"], ["cycle-leaf", "cycle-b"]]);
  assert.equal(projectNavigationId(p, "cycle-b"), "cycle-a");
  const all = [...nodes, ...local], index = new Map(all.map((node) => [node.id, node]));
  for (const node of all) {
    const seen = new Set(); let current = node;
    while (current) { assert.equal(seen.has(current.id), false); seen.add(current.id); current = index.get(current.parentId); }
  }
  const recovered = [...nodes.filter((node) => node.kind === "chat"), { id: "graph-followup" }].flatMap((node) => conversationNodes(p, node.id).map((paper) => paper.id));
  assert.deepEqual([...recovered].sort(), p.paperTree.nodes.filter((node) => node.kind === "chat").map((node) => node.id).sort());
  assert.deepEqual(p, before);
});

test("projection is stable, duplicate-free and preserves the former conversation APIs for saved references", () => {
  const p = fixture();
  p.paperTree.nodes.push({ ...p.paperTree.nodes[0], parentId: "different" });
  const before = structuredClone(p), nodes = projectNavigationNodes(p);
  assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length);
  assert.equal(conversationRoot(p, "formula-followup").id, "first");
  assert.deepEqual(conversationNodes(p, "first").map((node) => node.id), ["first", "formula-followup", "exercise-followup", "old-graph-followup"]);
  assert.deepEqual(projectNavigationNodes(p), nodes);
  assert.deepEqual(p, before);
});

test("conversation summaries find question history in branches without turning them into main conversations", () => {
  const p = fixture();
  p.chats.push(
    { id: "first", title: "第一章讨论", lastInteractionAt: "2026-09-27T08:00:00Z", messages: [
      { role: "user", content: "旧问题：观察空间是什么？" },
      { role: "assistant", content: "这是助手专有关键字" },
      { role: "user", content: "主对话的最后问题" },
    ] },
    { id: "formula-followup", title: "公式推导", lastInteractionAt: "2026-09-28T08:00:00Z", messages: [{ role: "user", content: "  分支里\n怎样推导公式？  " }] },
    { id: "exercise-followup", lastInteractionAt: "2026-09-26T08:00:00Z", messages: [{ role: "user", content: "另一分支的习题问题" }] },
    { id: "second", lastInteractionAt: "2026-09-29T08:00:00Z", messages: [{ role: "user", content: "独立对话的问题" }] },
  );
  const before = structuredClone(p), summary = conversationSummary(p, "first");
  assert.equal(summary.rootId, "first");
  assert.equal(summary.lastQuestion, "分支里 怎样推导公式？");
  assert.equal(summary.lastInteractionAt, "2026-09-28T08:00:00Z");
  assert.equal(summary.sortTime, Date.parse("2026-09-28T08:00:00Z"));
  assert.equal(summary.hasInteraction, true);
  for (const text of ["观察空间", "主对话的最后问题", "推导公式", "另一分支的习题问题"]) assert.ok(summary.searchText.includes(text));
  for (const text of ["助手专有关键字", "独立对话的问题"]) assert.equal(summary.searchText.includes(text), false);
  assert.deepEqual(conversationSummary(p, "formula-followup"), summary);
  assert.equal(projectNavigationNodes(p).some((node) => node.id === "formula-followup"), false);
  p.chats.reverse(); p.paperTree.nodes.reverse();
  assert.equal(conversationSummary(p, "first").lastQuestion, summary.lastQuestion, "array order does not select recent activity");
  p.chats.reverse(); p.paperTree.nodes.reverse();
  assert.deepEqual(p, before);
});

test("summaries tolerate old timestamps and empty chats without claiming a creation date is a question date", () => {
  const p = fixture();
  p.paperTree.nodes.find((node) => node.id === "first").created = "2026-09-01T00:00:00Z";
  p.paperTree.nodes.find((node) => node.id === "formula-followup").created = "2026-09-02T00:00:00Z";
  p.chats.push(
    { id: "first", lastInteractionAt: "invalid", messages: [{ role: "user", content: "旧主对话" }] },
    { id: "formula-followup", messages: [{ role: "user", content: "旧分支" }] },
    { id: "exercise-followup", lastInteractionAt: "2026-10-01T00:00:00Z", messages: [{ role: "assistant", content: "没有用户提问" }] },
  );
  const summary = conversationSummary(p, "first");
  assert.equal(summary.lastQuestion, "旧分支");
  assert.equal(summary.sortTime, Date.parse("2026-09-02T00:00:00Z"));
  assert.equal(summary.lastInteractionAt, undefined);
  const empty = conversationSummary(p, "second");
  assert.equal(empty.hasInteraction, false);
  assert.equal(empty.lastQuestion, "");
  assert.equal(empty.sortTime, 0);
  assert.equal(conversationSummary(p, "missing"), undefined);
});

test("question previews hide repeated auto-titles and keep distinct later questions", () => {
  for (const title of ["只用两句话概括", "只用两句话概括…", "只用两句话概括...", "只用两句话概括这一章。"])
    assert.equal(conversationQuestionPreview(title, "只用两句话概括这一章。"), "");
  assert.equal(conversationQuestionPreview("  只用两句话概括… ", "只用两句话概括\n这一章。"), "");
  assert.equal(conversationQuestionPreview("只用两句话概括…", "公式中的 α 代表什么？"), "公式中的 α 代表什么？");
  assert.equal(conversationQuestionPreview("阅读讨论", "  如何\n推导这个式子？ "), "如何 推导这个式子？");
  assert.equal(conversationQuestionPreview("阅读讨论"), "");
});

test("question search opens its exact branch and message independently of the last visited paper", () => {
  const p = fixture();
  p.chats.push(
    { id: "first", title: "模型讨论", messages: [{ id: "root-question", role: "user", content: "观察空间是什么？" }] },
    { id: "formula-followup", title: "公式分支", lastInteractionAt: "2026-09-27T00:00:00Z", messages: [
      { id: "bayes-question", role: "user", content: "贝叶斯公式怎样推导？" },
      { id: "answer", role: "assistant", content: "不能检索到的回答专有内容" },
    ] },
    { id: "exercise-followup", title: "最新打开的分支", lastInteractionAt: "2026-09-28T00:00:00Z", messages: [{ id: "practice-question", role: "user", content: "条件概率练习" }] },
    { id: "second", title: "独立对话", lastInteractionAt: "2026-09-29T00:00:00Z", messages: [{ id: "other-question", role: "user", content: "独立的贝叶斯问题" }] },
  );
  const before = structuredClone(p);
  assert.equal(conversationResumeTarget(p, "first", "exercise-followup").id, "exercise-followup");
  assert.deepEqual(conversationSearchMatch(p, "first", "贝叶斯"), {
    nodeId: "formula-followup", messageId: "bayes-question", text: "贝叶斯公式怎样推导？",
  });
  assert.deepEqual(conversationSearchMatch(p, "first", "观察空间"), {
    nodeId: "first", messageId: "root-question", text: "观察空间是什么？",
  });
  assert.deepEqual(conversationSearchMatch(p, "first", "公式分支"), {
    nodeId: "formula-followup", messageId: undefined, text: "公式分支",
  });
  for (const query of ["独立的", "回答专有内容", "", "  "]) assert.equal(conversationSearchMatch(p, "first", query), undefined);
  assert.equal(conversationSearchMatch(p, "missing", "贝叶斯"), undefined);
  assert.equal(conversationSearchMatch(p, "formula-followup", "贝叶斯"), undefined, "sidebar searches remain anchored in main entries");
  assert.deepEqual(projectNavigationNodes(p).filter((node) => node.id === "formula-followup"), []);
  assert.deepEqual(p, before);
});

test("resume stays in the saved main conversation and returns the exact existing paper without altering drafts or references", () => {
  const p = fixture();
  p.chats.push(
    { id: "first", messages: [{ id: "q", role: "user", content: "原问题" }], draft: "未发送草稿", pendingQuotes: [{ id: "quote", text: "引用" }] },
    { id: "formula-followup", messages: [], draft: "分支草稿", pendingQuotes: [{ id: "branch-quote", text: "另一条引用" }] },
    { id: "second", messages: [] },
    { id: "independent", messages: [] },
    { id: "history-chat", messages: [] },
  );
  p.paperTree.nodes.push(
    { id: "independent", kind: "chat", parentId: "first", conversationRoot: true },
    { id: "history-chat", kind: "chat", role: "history", parentId: "first" },
  );
  const before = structuredClone(p), root = p.paperTree.nodes.find((node) => node.id === "first");
  assert.equal(conversationResumeTarget(p, "first", "formula-followup"), p.paperTree.nodes.find((node) => node.id === "formula-followup"));
  for (const candidate of [undefined, "missing", "second", "independent", "history-chat", "exercise-followup", "formula", "chapter:1"])
    assert.equal(conversationResumeTarget(p, "first", candidate), root, `invalid candidate ${candidate} falls back to its own root`);
  assert.equal(conversationResumeTarget(p, "formula-followup", "first"), undefined, "a branch is not a main-conversation entry");
  assert.equal(conversationResumeTarget(p, "missing", "formula-followup"), undefined);
  assert.equal(conversationResumeTarget(p, "chapter:1", "formula-followup"), undefined);
  assert.equal(conversationResumeTarget(p, "unlocated"), p.paperTree.nodes.find((node) => node.id === "unlocated"));
  assert.deepEqual(p, before);
  p.chats = p.chats.filter((chat) => chat.id !== "first");
  assert.equal(conversationResumeTarget(p, "first"), undefined, "a dangling root cannot open a missing chat entity");
});

test("resume supports persisted node-to-chat aliases", () => {
  const p = fixture();
  p.chats.push({ id: "legacy-chat", messages: [] });
  const alias = { id: "alias-node", kind: "chat", objectId: "legacy-chat", parentId: "chapter:1", conversationRoot: true };
  p.paperTree.nodes.push(alias);
  assert.equal(conversationResumeTarget(p, "alias-node"), alias);
});
