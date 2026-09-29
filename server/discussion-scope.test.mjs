import test from "node:test";
import assert from "node:assert/strict";
import { discussionScope, discussionSources, nodeConversation } from "../src/discussion-scope.mjs";

function fixture() {
  const sources = ["a", "b", "c"].map((id) => ({
    id, title: id, pages: ["one", "two", "three", "four", "five"],
    chunks: Array.from({ length: 5 }, (_, i) => ({ id: `${id}:${i + 1}`, sourceId: id, page: i + 1, text: `${id}-${i + 1}` })),
  }));
  return {
    sources, activeSource: "c", chats: [], stages: [],
    paperTree: { nodes: [
      { id: "book:a", kind: "book", sourceId: "a", parentId: null },
      { id: "book:b", kind: "book", sourceId: "b", parentId: null },
      { id: "chapter:a", kind: "book", role: "chapter", sourceId: "a", anchor: { sourceId: "a", page: 3 }, endPage: 4, parentId: "book:a" },
      { id: "graph:a", kind: "graph", parentId: "chapter:a" },
      { id: "branch:a", kind: "chat", parentId: "graph:a" },
      { id: "stage:cross", kind: "path", role: "stage", sourceId: "a", stageId: "cross", parentId: null },
    ] },
  };
}

test("a source discussion remains attached to its whole source when reading moves", () => {
  const project = fixture();
  const scope = discussionScope(project, "book:a");
  assert.deepEqual(scope, { sourceId: "a" });
  const result = discussionSources(project, scope);
  assert.deepEqual(result.map((source) => source.id), ["a"]);
  assert.equal(result[0], project.sources[0]);
  assert.equal(result[0].pages.length, 5);
});

test("a source node cannot inherit a same-ID legacy tutor's page or last answer", () => {
  const project = fixture();
  const legacy = {id:"book:a",messages:[{role:"assistant",content:"old page answer",readingContext:{sourceId:"a",page:2}}]};
  project.chats.push(legacy);
  assert.equal(nodeConversation(project,project.paperTree.nodes[0]),undefined);
  assert.equal(nodeConversation(project,{id:"discussion:book:a",kind:"chat",objectId:"book:a"}),legacy);
  assert.deepEqual(discussionScope(project,"book:a"),{sourceId:"a"});
});

test("chapter descendants inherit exact physical ranges without renumbering citations", () => {
  const project = fixture();
  const scope = discussionScope(project, "branch:a");
  assert.deepEqual(scope, { scopeNodeId: "chapter:a", sourceId: "a" });
  const result = discussionSources(project, scope);
  assert.deepEqual(result[0].pages, ["", "", "three", "four", ""]);
  assert.deepEqual(result[0].chunks.map((chunk) => chunk.page), [3, 4]);
  assert.deepEqual(project.sources[0].pages, ["one", "two", "three", "four", "five"]);
  assert.equal(project.sources[0].chunks.length, 5);
});

test("stored discussion scope takes precedence over a changed tree parent", () => {
  const project = fixture();
  project.paperTree.nodes.find((node) => node.id === "branch:a").parentId = "book:b";
  project.chats.push({ id: "branch:a", context: { scopeNodeId: "chapter:a", sourceId: "a" } });
  assert.deepEqual(discussionScope(project, "branch:a"), { scopeNodeId: "chapter:a", sourceId: "a" });
});

test("legacy conversations use the same inherited source scope as ordinary conversations", () => {
  const project = fixture();
  project.chats.push({ id: "book:a", title: "实际话题", messages: [] });
  project.paperTree.nodes.push({ id: "discussion:book:a", objectId: "book:a", kind: "chat", parentId: "book:a" });
  project.sources[0].progress = 5;
  const scope = discussionScope(project, "discussion:book:a");
  assert.deepEqual(scope, { sourceId: "a" });
  assert.deepEqual(discussionSources(project, scope).map((source) => source.id), ["a"]);
  assert.equal(project.chats[0].context, undefined, "do not infer a fixed page from current reading progress");
});

test("saved reading source wins over display ancestry even without a separate sourceId", () => {
  const project = fixture();
  project.chats.push({ id: "branch:a", context: { reading: { sourceId: "b", page: 2 } } });
  const scope = discussionScope(project, "branch:a");
  assert.deepEqual(scope, { scopeNodeId: undefined, sourceId: "b" });
  assert.deepEqual(discussionSources(project, scope).map((source) => source.id), ["b"]);
});

test("cross-source stages include all anchored sources rather than only the first source", () => {
  const project = fixture();
  project.stages.push({ id: "cross", anchors: [{ sourceId: "a", page: 3 }, { sourceId: "b", page: 1 }, { sourceId: "a", page: 4 }] });
  const scope = discussionScope(project, "stage:cross");
  assert.deepEqual(discussionSources(project, scope).map((source) => source.id), ["a", "b"]);
  assert.equal(discussionSources(project, scope)[0].chunks.length, 5);
});

test("missing anchored or explicitly scoped sources do not broaden to the project", () => {
  const project = fixture();
  project.stages.push({ id: "cross", anchors: [{ sourceId: "deleted", page: 1 }] });
  assert.deepEqual(discussionSources(project, discussionScope(project, "stage:cross")), []);
  assert.deepEqual(discussionSources(project, { sourceId: "deleted" }), []);
  project.sources = project.sources.filter((source) => source.id !== "a");
  assert.deepEqual(discussionSources(project, { scopeNodeId: "chapter:a" }), []);
});

test("cycles stop safely and unscoped discussions retain project scope", () => {
  const project = fixture();
  project.paperTree.nodes.push({ id: "cycle1", kind: "graph", parentId: "cycle2" }, { id: "cycle2", kind: "graph", parentId: "cycle1" });
  assert.deepEqual(discussionScope(project, "cycle1"), {});
  assert.equal(discussionSources(project), project.sources);
});
