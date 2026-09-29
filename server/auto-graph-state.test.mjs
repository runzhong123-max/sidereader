import test from "node:test";
import assert from "node:assert/strict";
import { autoGraphPlan, shouldGenerateGraph, nextAutoGraphState, applyAutoGraphResult } from "../src/auto-graph-state.mjs";
import { addProposalNodes, attachPaperNode, ensureScopeGraph, normalizePaperTree, scopeGraphId } from "../src/paper-tree-state.mjs";

const source = (id, count = 6) => ({
  id, title: `资料 ${id}`, kind: "pdf", pages: Array.from({ length: count }, (_, i) => `${id} 第 ${i + 1} 页正文`), progress: 1,
  chunks: Array.from({ length: count }, (_, i) => ({ id: `${id}-${i + 1}`, sourceId: id, title: `资料 ${id}`, page: i + 1, text: `${id} 第 ${i + 1} 页正文` })),
  outline: [{ title: "第一章", page: 1, endPage: 3, level: 1, kind: "chapter" }, { title: "第二章", page: 4, endPage: count, level: 1, kind: "chapter" }],
});
const concept = (id, name = id, patch = {}) => ({ id, name, description: `${name} 定义`, x: 100, y: 200, group: 0, links: [], ...patch });
const project = (patch = {}) => normalizePaperTree({
  id: "p", name: "课程", goal: "理解课程", version: 1, sources: [source("s")], concepts: [], stages: [], sets: [],
  chats: [{ id: "tutor", title: "项目 tutor", messages: [] }], tabs: [{ id: "tutor", kind: "chat" }], activeTab: "tutor", page: 1, activeSource: "s", ...patch,
});
const graph = (project, id) => project.paperTree.nodes.find((node) => node.id === id);
const frozen = (value) => { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(frozen); } return value; };

test("chapter plans share the exact physical discussion range and inherit from child conversations", () => {
  let p = project();
  p = attachPaperNode({ ...p, chats: [...p.chats, { id: "child", title: "追问", messages: [] }] }, { id: "child", kind: "chat", parentId: "s@4:1" });
  const plan = autoGraphPlan(p, "child");
  assert.equal(plan.ownerId, "s@4:1");
  assert.equal(plan.scope.kind, "chapter");
  assert.deepEqual(plan.chunks.map((chunk) => chunk.page), [4, 5, 6]);
  assert.equal(plan.graphId, scopeGraphId("s@4:1"));
  assert.equal(autoGraphPlan(ensureScopeGraph(p, plan.ownerId), plan.graphId).fingerprint, plan.fingerprint);
});

test("explicit discussion scope wins over its display parent for generation and proposal ownership", () => {
  let p = project({ concepts: [concept("owned")], stages: [{ id: "st", title: "关卡" }] });
  const proposal = { concepts: [concept("owned")], stages: [] };
  for (const [scopeNodeId, expectedKind] of [["s@4:1", "chapter"], ["book:s", "project"], ["stage:st", "project"], ["deleted", "project"]]) {
    const id = `discussion:${scopeNodeId}`;
    p = attachPaperNode({ ...p, chats: [...p.chats, { id, title: "讨论", messages: [], context: { scopeNodeId } }] }, { id, kind: "chat", parentId: "s@1:1" });
    const plan = autoGraphPlan(p, id);
    assert.equal(plan.scope.kind, expectedKind);
    assert.equal(plan.ownerId, expectedKind === "chapter" ? "s@4:1" : "tutor");
    const applied = addProposalNodes(p, id, "m", proposal);
    assert.equal(graph(applied, scopeGraphId("s@1:1")), undefined);
    assert.deepEqual(graph(applied, scopeGraphId("s@4:1"))?.conceptIds, expectedKind === "chapter" ? ["owned"] : undefined);
  }
  const sourceOnly = attachPaperNode({ ...p, chats: [...p.chats, { id: "source-only", messages: [], context: { sourceId: "s" } }] }, { id: "source-only", kind: "chat", parentId: "s@1:1" });
  assert.equal(autoGraphPlan(sourceOnly, "source-only").scope.kind, "project");
  assert.equal(graph(addProposalNodes(sourceOnly, "source-only", "m", proposal), scopeGraphId("s@1:1")), undefined);
});

test("fingerprints ignore source progress, project concept edits and text outside the chapter", () => {
  const p = project();
  const first = autoGraphPlan(p, "s@4:1");
  const progress = { ...p, page: 5, concepts: [concept("manual")], sources: p.sources.map((item) => ({ ...item, progress: 5 })) };
  assert.equal(autoGraphPlan(progress, "s@4:1").fingerprint, first.fingerprint);
  const outside = { ...p, sources: p.sources.map((item) => ({ ...item, chunks: item.chunks.map((chunk) => chunk.page === 1 ? { ...chunk, text: "第一章修订" } : chunk) })) };
  assert.equal(autoGraphPlan(outside, "s@4:1").fingerprint, first.fingerprint);
  const inside = { ...p, sources: p.sources.map((item) => ({ ...item, chunks: item.chunks.map((chunk) => chunk.page === 4 ? { ...chunk, text: "第二章修订" } : chunk) })) };
  assert.notEqual(autoGraphPlan(inside, "s@4:1").fingerprint, first.fingerprint);
});

test("stages and their discussions use the project graph instead of owning another graph", () => {
  let p = project({ sources: [source("a"), source("b")], stages: [{ id: "st", title: "综合练习", description: "对比两个方法", anchors: [{ sourceId: "a", page: 2 }, { sourceId: "b", page: 5 }] }] });
  const plan = autoGraphPlan(p, "stage:st");
  assert.equal(plan.scope.kind, "project");
  assert.equal(plan.graphId, "graph");
  assert.equal(plan.chunks.length, 12);
  assert.equal(plan.fingerprint, autoGraphPlan(p, "tutor").fingerprint);
  p = attachPaperNode(p, { id: "stage-chat", kind: "chat", parentId: "stage:st" });
  assert.equal(autoGraphPlan(p, "stage-chat").fingerprint, plan.fingerprint);
  assert.equal(autoGraphPlan(project({ stages: [{ id: "st", title: "无定位的关卡" }] }), "stage:st").scope.kind, "project");
  assert.equal(autoGraphPlan(project({ sources: [], stages: [{ id: "st", title: "无资料的关卡" }] }), "stage:st"), null);
});

test("project sources and defaults resolve globally while saved result graphs stay untouched", () => {
  let p = project({ sources: [source("a"), source("b")] });
  const plan = autoGraphPlan(p, "tutor");
  assert.equal(plan.chunks.length, 12);
  for (const id of ["graph", "path", "book:a", p.paperTree.rootId]) assert.equal(autoGraphPlan(p, id).fingerprint, plan.fingerprint);
  p = attachPaperNode(p, { id: "tool:one", kind: "graph", parentId: "a@1:1", origin: "tool", conceptIds: [] });
  assert.equal(autoGraphPlan(p, "tool:one"), null);
  assert.equal(autoGraphPlan(p, "deleted-owner"), null);
});

test("historical stage graphs do not regenerate and late stage-scoped responses are discarded", () => {
  let p = project({ stages: [{ id: "st", title: "旧关卡" }] });
  const graphId = scopeGraphId("stage:st");
  p = normalizePaperTree({ ...p, paperTree: { ...p.paperTree, nodes: [...p.paperTree.nodes,
    { id: graphId, kind: "graph", role: "scope-graph", parentId: "stage:st", conceptIds: [], autoGraph: { status: "generating", fingerprint: "old-stage-plan" } },
  ] } });
  assert.equal(graph(p, graphId).role, "history");
  assert.equal(autoGraphPlan(p, graphId), null);
  p = attachPaperNode(p, { id: "old-graph-chat", kind: "chat", parentId: graphId });
  assert.equal(autoGraphPlan(p, "old-graph-chat"), null);
  const oldPlan = { graphId, ownerId: "stage:st", fingerprint: "old-stage-plan", scope: { kind: "stage", title: "旧关卡" }, chunks: p.sources[0].chunks };
  assert.equal(shouldGenerateGraph(p, oldPlan), false);
  assert.equal(nextAutoGraphState(p, oldPlan, { status: "error" }), p);
  assert.equal(applyAutoGraphResult(p, oldPlan, [concept("late")]), p);
});

test("empty or invalid source chunks do not start generation", () => {
  const p = project({ sources: [{ ...source("s"), chunks: [{ text: " " }, { text: "错误页码", page: 30 }] }] });
  assert.equal(autoGraphPlan(p, "tutor"), null);
  assert.equal(shouldGenerateGraph(p, null), false);
});

test("existing conversation or manual concepts still receive a first scope extraction", () => {
  const p = project({ concepts: [concept("manual")] });
  assert.equal(shouldGenerateGraph(p, autoGraphPlan(p, "tutor")), true);
  let chapter = ensureScopeGraph(p, "s@1:1");
  chapter = { ...chapter, paperTree: { ...chapter.paperTree, nodes: chapter.paperTree.nodes.map((node) => node.id === scopeGraphId("s@1:1") ? { ...node, conceptIds: ["manual"] } : node) } };
  assert.equal(shouldGenerateGraph(chapter, autoGraphPlan(chapter, "s@1:1")), true);
  assert.equal(shouldGenerateGraph(p, autoGraphPlan(p, "s@4:1")), true);
  const plan = autoGraphPlan(chapter, "s@1:1");
  const completed = applyAutoGraphResult(chapter, plan, [concept("new")]);
  assert.deepEqual(completed.concepts[0], p.concepts[0]);
  assert.equal(graph(completed, plan.graphId).conceptIds[0], "manual");
  assert.equal(shouldGenerateGraph(completed, plan), false);
});

test("legacy extraction is upgraded once and persists the actual evidence coverage", () => {
  let p = project({ concepts: [concept("legacy")] });
  const plan = autoGraphPlan(p, "s@1:1");
  p = nextAutoGraphState(p, plan, { status: "ready" });
  p = { ...p, paperTree: { ...p.paperTree, nodes: p.paperTree.nodes.map((node) => node.id === plan.graphId
    ? { ...node, autoGraph: { ...node.autoGraph, fingerprint: plan.fingerprint.replace("auto-graph-v2:", "auto-graph-v1:") } } : node) } };
  assert.equal(shouldGenerateGraph(p, plan), true);
  const coverage = { sampledPages: 3, totalPages: 3, sampledChunks: 4, totalChunks: 6, truncated: true };
  const completed = applyAutoGraphResult(p, plan, [concept("new")], coverage);
  assert.equal(shouldGenerateGraph(completed, plan), false);
  assert.deepEqual(graph(completed, plan.graphId).autoGraph.coverage, coverage);
  assert.deepEqual(completed.concepts[0], p.concepts[0]);
  const running = nextAutoGraphState(completed, plan, { status: "generating" });
  assert.equal(graph(running, plan.graphId).autoGraph.coverage, undefined);
  const failed = nextAutoGraphState(running, plan, { status: "error", error: "离线" });
  assert.deepEqual(failed.concepts, completed.concepts);
  assert.equal(shouldGenerateGraph(failed, plan), false);
});

test("graph lifecycle persists retry boundaries and does not navigate or create conversations", () => {
  const p = frozen(project());
  const plan = autoGraphPlan(p, "s@1:1");
  assert.equal(shouldGenerateGraph(p, plan), true);
  const running = nextAutoGraphState(p, plan, { status: "generating", startedAt: "now" });
  assert.equal(graph(running, plan.graphId).autoGraph.startedAt, "now");
  assert.equal(shouldGenerateGraph(running, plan), true);
  const failed = nextAutoGraphState(running, plan, { status: "error", error: "离线" });
  assert.equal(shouldGenerateGraph(failed, plan), false);
  assert.equal(graph(failed, plan.graphId).autoGraph.error, "离线");
  const retry = nextAutoGraphState(failed, plan, { status: "generating" });
  assert.equal(graph(retry, plan.graphId).autoGraph.error, undefined);
  assert.equal(shouldGenerateGraph(retry, plan), true);
  for (const field of ["activeTab", "tabs", "chats", "stages"]) assert.equal(retry[field], p[field]);
});

test("model-local ids cannot collide across chapter graphs and links resolve to canonical ids", () => {
  let p = project();
  const first = autoGraphPlan(p, "s@1:1");
  p = applyAutoGraphResult(p, first, [concept("c1", "监督学习", { links: ["c2", "missing"] }), concept("c2", "标签")]);
  const second = autoGraphPlan(p, "s@4:1");
  p = applyAutoGraphResult(p, second, [concept("c1", "聚类", { links: ["c2"] }), concept("c2", "距离")]);
  assert.equal(new Set(p.concepts.map((item) => item.id)).size, 4);
  assert.ok(p.concepts.every((item) => item.id.startsWith("auto:") && item.id.length <= 100));
  assert.notEqual(p.concepts[0].id.split(":").slice(0, 3).join(":"), p.concepts[2].id.split(":").slice(0, 3).join(":"));
  assert.deepEqual(p.concepts[0].links, [p.concepts[1].id]);
  assert.deepEqual(p.concepts[2].links, [p.concepts[3].id]);
  assert.deepEqual(graph(p, first.graphId).conceptIds, p.concepts.slice(0, 2).map((item) => item.id));
  assert.equal(shouldGenerateGraph(p, second), false);
});

test("name deduplication preserves edited descriptions and layout while unioning valid references", () => {
  const original = concept("edited", "梯度", { description: "用户自己的定义", x: 9, y: 10, group: 3, layout: { x: 19, y: 20 }, links: ["kept"], anchors: [{ sourceId: "s", page: 1, title: "原引用" }] });
  let p = frozen(project({ concepts: [original, concept("kept", "旧概念")] }));
  const plan = autoGraphPlan(p, "s@1:1");
  p = applyAutoGraphResult(p, plan, [
    concept("c1", " 梯度 ", { description: "覆盖描述", x: 90, links: ["c2"], anchors: [{ sourceId: "s", page: 2, title: "引用" }, { sourceId: "s", page: 5, title: "范围外" }, { sourceId: "missing", page: 1 }] }),
    concept("c2", "损失"), concept("duplicate", "损失", { links: ["c1"] }),
  ]);
  assert.equal(p.concepts.length, 3);
  const updated = p.concepts[0];
  for (const field of ["id", "name", "description", "x", "y", "group", "layout"]) assert.deepEqual(updated[field], original[field]);
  assert.deepEqual(updated.links, ["kept", p.concepts[2].id]);
  assert.deepEqual(updated.anchors.map((anchor) => anchor.page), [1, 2]);
  assert.deepEqual(p.concepts[2].links, ["edited"]);
  assert.deepEqual(graph(p, plan.graphId).conceptIds, ["edited", p.concepts[2].id]);
  assert.equal(p.activeTab, "tutor");
});

test("deleted owners and changed source ranges discard late generation results", () => {
  const p = project();
  const plan = autoGraphPlan(p, "s@1:1");
  const removed = normalizePaperTree({ ...p, sources: [] });
  assert.equal(applyAutoGraphResult(removed, plan, [concept("c1")]), removed);
  assert.equal(nextAutoGraphState(removed, plan, { status: "error" }), removed);
  const changed = normalizePaperTree({ ...p, sources: [{ ...p.sources[0], outline: [{ title: "第一章", page: 1, endPage: 2, level: 1, kind: "chapter" }, { title: "第二章", page: 3, endPage: 6, level: 1, kind: "chapter" }] }] });
  assert.equal(applyAutoGraphResult(changed, plan, [concept("c1")]), changed);
  assert.equal(shouldGenerateGraph(changed, plan), false);
});

test("empty model results remain an explicit retriable failure, while new content permits a new run", () => {
  let p = project();
  const plan = autoGraphPlan(p, "tutor");
  p = applyAutoGraphResult(p, plan, [null, { name: " " }]);
  assert.equal(graph(p, "graph").autoGraph.status, "error");
  assert.equal(shouldGenerateGraph(p, plan), false);
  const revised = { ...p, sources: [{ ...p.sources[0], chunks: [...p.sources[0].chunks, { id: "extra", sourceId: "s", page: 2, text: "补充知识", title: "资料 s" }] }] };
  assert.equal(shouldGenerateGraph(revised, autoGraphPlan(revised, "tutor")), true);
});

test("repeated results are idempotent for concepts and keep unrelated scope selections", () => {
  let p = project({ concepts: [concept("manual")] });
  p = ensureScopeGraph(p, "s@1:1");
  const graphId = scopeGraphId("s@1:1");
  p = { ...p, paperTree: { ...p.paperTree, nodes: p.paperTree.nodes.map((node) => node.id === graphId ? { ...node, conceptIds: ["manual"] } : node) } };
  const plan = autoGraphPlan(p, "s@1:1");
  const result = [concept("c1", "新概念", { anchors: [{ sourceId: "s", page: 1, title: "资料 s" }] })];
  const once = applyAutoGraphResult(p, plan, result);
  const twice = applyAutoGraphResult(once, plan, result);
  assert.deepEqual(twice.concepts, once.concepts);
  assert.deepEqual(graph(twice, graphId).conceptIds, graph(once, graphId).conceptIds);
  assert.equal(graph(twice, graphId).conceptIds[0], "manual");
});

test("long Unicode chapter owners produce short stable canonical IDs usable by the generation API", () => {
  const sourceId = `教材目录/${"机器学习教材与深入理解章节".repeat(12)}.pdf`;
  const p = project({ sources: [source(sourceId)] });
  const plan = autoGraphPlan(p, `${sourceId}@1:1`);
  assert.ok(plan.graphId.length > 100);
  const concepts = [concept("c1", "基础概念", { links: ["c2"] }), concept("c2", "深入概念")];
  const first = applyAutoGraphResult(p, plan, concepts);
  const repeated = applyAutoGraphResult(p, plan, concepts);
  assert.deepEqual(first.concepts, repeated.concepts);
  assert.ok(first.concepts.every((item) => item.id.length <= 100 && item.links.every((id) => id.length <= 100)));
  assert.deepEqual(first.concepts[0].links, [first.concepts[1].id]);
});

test("late results may restore a deleted graph while its owning chapter still exists", () => {
  const p = project();
  const plan = autoGraphPlan(p, "s@1:1");
  const running = nextAutoGraphState(p, plan, { status: "generating" });
  const withoutGraph = { ...running, paperTree: { ...running.paperTree, nodes: running.paperTree.nodes.filter((node) => node.id !== plan.graphId) } };
  const result = applyAutoGraphResult(withoutGraph, plan, [concept("c1", "完成的知识点")]);
  assert.equal(graph(result, plan.graphId).parentId, plan.ownerId);
  assert.equal(graph(result, plan.graphId).autoGraph.status, "ready");
  assert.equal(result.activeTab, withoutGraph.activeTab);
});
