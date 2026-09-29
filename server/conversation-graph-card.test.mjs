import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  stdin: { contents: `export { default as ConversationGraphCard } from './src/components/ConversationGraphCard.tsx'; export { default as Graph } from './src/components/Graph.tsx'; export { default as GraphRelations } from './src/components/GraphRelations.tsx';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  plugins: [{ name: "server-render-dependencies", setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: "styles", namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    builder.onResolve({ filter: /^[^./]/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { ConversationGraphCard, Graph, GraphRelations } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

const graph = { id: "g", title: "对话逻辑", concepts: [
  { id: "a", name: "观察", description: "看到的信息", links: ["b"] },
  { id: "b", name: "行动", description: "根据观察决策", links: ["c"] },
  { id: "c", name: "反馈", description: "行动带来新的观察", links: ["a"] },
  { id: "d", name: "环境边界", description: "暂未连接的概念", links: [] },
] };
const render = (props = {}) => renderToStaticMarkup(createElement(ConversationGraphCard, { graph, ...props }));
const conceptControls = (html) => [...html.matchAll(/<g\b[^>]*role="button"[^>]*aria-label="查看概念：([^"<>]+)"[^>]*>/g)];
const graphEdges = (html) => [...html.matchAll(/<(?:line|path)\b[^>]*class="network-edge(?:[ "][^>]*)?>/g)];

test("relation details distinguish prerequisites from next concepts without inventing order in a dialogue or cycle", () => {
  const concepts = [
    { id: "a", name: "向量", links: [] },
    { id: "b", name: "线性模型", links: ["a"] },
    { id: "c", name: "回归", links: ["b"] },
  ];
  const details = (source, relationKind) => renderToStaticMarkup(createElement(GraphRelations, { concepts: source, activeId: "b", relationKind, onSelect() {} }));
  const chapter = details(concepts, "prerequisite");
  assert.match(chapter, /直接先修[\s\S]*向量[\s\S]*直接后续[\s\S]*回归/);
  assert.equal((chapter.match(/<button\b/g) || []).length, 2);
  const dialogue = details(concepts, "related");
  assert.match(dialogue, /关联概念/);
  assert.doesNotMatch(dialogue, /直接先修|直接后续/);
  const cycle = details(concepts.map((c) => c.id === "a" ? { ...c, links: ["c"] } : c), "prerequisite");
  assert.match(cycle, /相互关联/);
  assert.doesNotMatch(cycle, /直接先修|直接后续/);
});

test("conversation graph uses the full readable graph while keeping cyclic and disconnected source concepts", () => {
  const original = JSON.stringify(graph);
  const html = render({ projectId: "p", workspaceNodeId: "card", onOpen() {}, onReferenceConcept() {} });
  assert.deepEqual(conceptControls(html).map((match) => match[1]).sort(), graph.concepts.map((concept) => concept.name).sort(), "the initial view shows real concepts, including the disconnected concept, without adding synthetic roots");
  assert.equal(graphEdges(html).length, 3, "all three original cycle relations remain; there is no invented link to the disconnected concept");
  for (const control of conceptControls(html)) {
    assert.match(control[0], /tabindex="0"/, "concept inspection is keyboard reachable");
    assert.doesNotMatch(control[0], /disabled=/);
  }
  assert.doesNotMatch(html, /(?:NaN|Infinity)/, "cycle handling produces finite geometry");
  assert.equal(JSON.stringify(graph), original, "the embedded view never rewrites source concepts or relations");
});

test("conversation relations are associations and the initial card keeps controls collapsed", () => {
  const html = render({ projectId: "p", onReferenceConcept() {} });
  assert.match(html, /本次对话图谱/);
  assert.doesNotMatch(html, /marker-end=/, "conversation links do not imply prerequisite arrows");
  assert.doesNotMatch(html, /先修|新增概念|编辑概念|删除概念|补全本章|更新图谱|图谱操作/);
  assert.match(html, /aria-label="图谱缩放"/);
  assert.match(html, /aria-label="适应图谱大小"/);
  assert.doesNotMatch(html, /aria-label="放大图谱"|aria-label="缩小图谱"/, "individual zoom actions are absent until the real ActionMenu is opened");
  assert.doesNotMatch(html, /引用概念：|点击概念引用/, "a concept click focuses attention; referencing remains explicit");
});

test("an editable graph initially renders only search, layout, scale, fit and one follow-up action", () => {
  const html = renderToStaticMarkup(createElement(Graph, {
    concepts: graph.concepts, onChange() {}, onAskGraph() {},
    automatic: { status: "idle", onRetry() {}, scopeLabel: "本章", coverage: { sampledPages: 20, totalPages: 20, sampledChunks: 29, totalChunks: 29 } },
  }));
  const header = html.match(/<header class="network-toolbar"[\s\S]*?<\/header>/)?.[0];
  const footer = html.match(/<footer class="network-footer"[\s\S]*?<\/footer>/)?.[0];
  assert.ok(header); assert.ok(footer);
  assert.match(header, /aria-label="搜索图谱概念"/);
  assert.match(header, /aria-label="展开方式：核心展开"/);
  assert.equal((header.match(/<button\b/g) || []).length, 1, "only the layout trigger is a button in the idle top bar");
  assert.equal((footer.match(/<button\b/g) || []).length, 3, "scale, fit and follow-up share the bottom edge");
  assert.equal((html.match(/aria-label="追问这个图谱"/g) || []).length, 1);
  assert.doesNotMatch(html, /action-menu-panel|显示设置|图谱内容|高亮几级关联|新增概念|恢复自动布局|补全本章图谱|已参考 20\/20/,
    "real SSR includes neither unopened menu contents nor completed generation statistics");
  assert.doesNotMatch(html, /network-exploration|network-toolbar-actions|network-zoom|object-discussion-action/,
    "the obsolete persistent rows do not survive in the rendered graph");
});

test("active generation and failure remain visible without exposing the configuration menu", () => {
  for (const status of ["generating", "error"]) {
    const html = renderToStaticMarkup(createElement(Graph, {
      concepts: graph.concepts, automatic: { status, onRetry() {}, message: "验收示例状态" },
    }));
    assert.match(html, new RegExp(status === "generating" ? "正在更新图谱" : "图谱更新未完成"));
    assert.match(html, /role="status" aria-live="polite"/);
    assert.doesNotMatch(html, /action-menu-panel/);
    if (status === "error") assert.match(html, /aria-label="重试更新知识图谱"/);
  }
});

test("only a registered object header starts a workspace transfer, with reading available without a reference receiver", () => {
  const registered = render({ projectId: "p", workspaceNodeId: "card", onOpen() {} });
  const header = registered.match(/<button[^>]*class="learning-object-title"[^>]*>/)?.[0];
  assert.ok(header);
  assert.match(header, /aria-label="展开图谱卡片：对话逻辑"/);
  assert.match(header, /draggable="true"/);
  assert.equal((registered.match(/draggable="true"/g) || []).length, 1, "only the title uses native workspace drag; graph concepts use the shared reference gesture");
  const standalone = render();
  assert.equal(conceptControls(standalone).length, graph.concepts.length);
  assert.doesNotMatch(standalone, /draggable="true"/, "unregistered cards cannot manufacture a workspace transfer");
});
