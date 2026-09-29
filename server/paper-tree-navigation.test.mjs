import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/components/PaperTree.tsx", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  plugins: [{ name: "navigation-projection-dependencies", setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: "styles", namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
    builder.onResolve({ filter: /^[^./]/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { buildPaperTree } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

function fixture() {
  return {
    id: "p", name: "教材", sources: [{ id: "s", kind: "pdf", pages: Array(10).fill("") }],
    chats: [{ id: "tutor", messages: [] }], papers: [], sets: [], stages: [], concepts: [],
    paperTree: { rootId: "project:p", tutorId: "tutor", nodes: [
      { id: "tutor", kind: "chat", parentId: "project:p" },
      { id: "book:s", kind: "book", role: "source", sourceId: "s", parentId: "project:p" },
      { id: "chapter", kind: "book", role: "chapter", sourceId: "s", title: "第一章", parentId: "book:s", anchor: { sourceId: "s", page: 1 }, endPage: 10 },
    ] },
  };
}

test("unextracted chapters keep an accessible graph entry before any graph entity exists", () => {
  const project = fixture(), before = structuredClone(project);
  const { entries } = buildPaperTree(project);
  const chapter = entries.get("chapter");
  const materialGroup = chapter.children.map((id) => entries.get(id)).find((entry) => entry.group === "materials");
  assert.ok(materialGroup, "students can expand learning materials with the mouse before generation");
  assert.equal(materialGroup.children.length, 1);
  const graph = entries.get(materialGroup.children[0]);
  assert.equal(graph.label, "知识图谱");
  assert.equal(graph.node.id, "scope-graph:chapter");
  assert.equal(graph.material.graphScopeId, "chapter", "activation materializes the missing graph through onOpenScopeGraph");
  assert.equal(materialGroup.defaultExpanded, undefined, "the pending graph does not automatically expand the directory");
  assert.equal(chapter.children.some((id) => entries.get(id).group === "conversations"), false);
  assert.deepEqual(project, before, "navigation indexing does not generate or persist anything");
});

test("existing graph identities open directly and main conversations stay in a separate recent-order group", () => {
  const project = fixture();
  project.paperTree.nodes.push(
    { id: "saved-graph", kind: "graph", role: "scope-graph", parentId: "chapter" },
    { id: "old", kind: "chat", parentId: "chapter" },
    { id: "new", kind: "chat", parentId: "chapter" },
    { id: "new-branch", kind: "chat", parentId: "old" },
  );
  project.chats.push(
    { id: "old", title: "旧主对话", lastInteractionAt: "2026-09-25T00:00:00Z", messages: [{ role: "user", content: "旧问题" }] },
    { id: "new", title: "新主对话", lastInteractionAt: "2026-09-27T00:00:00Z", messages: [{ role: "user", content: "新问题" }] },
    { id: "new-branch", title: "旧对话里的新追问", lastInteractionAt: "2026-09-28T00:00:00Z", messages: [{ role: "user", content: "继续旧问题" }] },
  );
  const { entries } = buildPaperTree(project);
  assert.equal(entries.get("saved-graph").material.graphScopeId, undefined);
  assert.equal(entries.has("scope-graph:chapter"), false);
  const groups = entries.get("chapter").children.map((id) => entries.get(id));
  assert.deepEqual(groups.find((entry) => entry.group === "conversations").children, ["old", "new"]);
  assert.deepEqual(groups.find((entry) => entry.group === "materials").children, ["saved-graph"]);
  assert.equal(entries.has("new-branch"), false);
});
