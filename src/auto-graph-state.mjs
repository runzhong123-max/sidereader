import { discussionSources } from "./discussion-scope.mjs";
import { ensureScopeGraph, normalizePaperTree, scopeGraphId } from "./paper-tree-state.mjs";
import { knowledgeGraphOwner } from "./knowledge-scope.mjs";

// Source content uses immutable arrays. Reading progress creates new Source
// objects, so caching by the chunks array avoids rehashing a book on scrolling.
const sourceCache = new WeakMap();
const nameKey = (name) => String(name || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const nodeFor = (project, id) => project.paperTree?.nodes.find((node) => node.id === id);

function hash(text) {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}:${text.length}`;
}

function sourceContent(source) {
  const chunks = source.chunks || [];
  let bySource = sourceCache.get(chunks);
  if (!bySource) sourceCache.set(chunks, bySource = new Map());
  const key = `${source.id}:${source.title}:${source.pages?.length || 0}`;
  if (bySource.has(key)) return bySource.get(key);
  const valid = chunks.filter((chunk) => chunk && typeof chunk.text === "string" && chunk.text.trim() &&
    Number.isInteger(chunk.page) && chunk.page >= 1 && chunk.page <= (source.pages?.length || 0));
  const entries = valid.map((chunk) => ({
    chunk: chunk.sourceId === source.id ? chunk : { ...chunk, sourceId: source.id },
    fingerprint: hash(JSON.stringify([source.id, chunk.page, chunk.title || source.title, chunk.path || "", chunk.text])),
  }));
  bySource.set(key, entries);
  return entries;
}

function graphOwner(project, activeNodeId) {
  const nodes = project.paperTree?.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let node = byId.get(activeNodeId);
  if (!node && activeNodeId === project.paperTree?.rootId) node = byId.get(project.paperTree.tutorId);
  if (!node) return null;
  const seen = new Set();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    // A result graph is a saved selection, never an automatic destination.
    if (node.kind === "graph" && node.id !== "graph" && node.role !== "scope-graph") return null;
    node = byId.get(node.parentId);
  }
  return knowledgeGraphOwner(project, activeNodeId) || null;
}

/** Resolve an automatic graph's immutable source scope without opening a tab. */
export function autoGraphPlan(project, activeNodeId) {
  const owner = graphOwner(project, activeNodeId);
  if (!owner) return null;
  const kind = owner.role === "chapter" ? "chapter" : "project";
  const scope = {
    kind,
    title: kind === "project" ? project.name : owner.title || "本章",
    ...(kind === "project" && project.goal ? { description: project.goal } : {}),
  };
  const graphId = kind === "project" ? "graph" : scopeGraphId(owner.id);
  let entries = [];
  let boundaries;
  if (kind === "chapter") {
    // discussionSources defines the same physical range as chapter discussions.
    const scoped = discussionSources(project, { scopeNodeId: owner.id });
    const source = project.sources.find((item) => item.id === scoped[0]?.id);
    if (!source) return null;
    const start = owner.anchor?.page || 1;
    const end = owner.endPage || source.pages.length;
    entries = sourceContent(source).filter(({ chunk }) => chunk.page >= start && chunk.page <= end);
    boundaries = [[source.id, start, end]];
  } else {
    entries = project.sources.flatMap(sourceContent);
    boundaries = project.sources.map((source) => [source.id, 1, source.pages.length]);
  }
  if (!entries.length) return null;
  const fingerprint = `auto-graph-v2:${hash(JSON.stringify([owner.id, scope, boundaries, entries.map((entry) => entry.fingerprint)]))}`;
  return { graphId, ownerId: owner.id, fingerprint, scope, chunks: entries.map((entry) => entry.chunk) };
}

function currentPlan(project, plan) {
  const current = autoGraphPlan(project, plan.ownerId);
  return current?.graphId === plan.graphId && current.fingerprint === plan.fingerprint ? current : null;
}

/** Same-scope failures wait for a deliberate retry; persisted in-flight jobs resume. */
export function shouldGenerateGraph(project, plan) {
  if (!plan || !currentPlan(project, plan)) return false;
  const graph = nodeFor(project, plan.graphId);
  // Conversation proposals and manual concepts do not prove that this scope
  // has been extracted. The additive merge below preserves those edits.
  if (!graph?.autoGraph) return true;
  if (graph.autoGraph.fingerprint !== plan.fingerprint) return true;
  return graph.autoGraph.status === "generating";
}

/** Persist lifecycle state, leaving the active paper and every conversation intact. */
export function nextAutoGraphState(project, plan, update) {
  if (!currentPlan(project, plan)) return project;
  const next = plan.graphId === "graph" ? normalizePaperTree(project) : ensureScopeGraph(project, plan.ownerId);
  const graph = nodeFor(next, plan.graphId);
  if (!graph) return project;
  const previous = graph.autoGraph?.fingerprint === plan.fingerprint ? graph.autoGraph : {};
  const state = { ...previous, ...update, fingerprint: plan.fingerprint };
  if (update.status === "generating") {
    state.startedAt = update.startedAt || new Date().toISOString();
    delete state.error;
    delete state.completedAt;
    delete state.coverage;
  } else if (update.status === "ready") {
    state.completedAt = update.completedAt || new Date().toISOString();
    delete state.error;
  } else if (update.status === "error") {
    state.error = update.error || "知识图谱生成未完成，请重试。";
    delete state.completedAt;
  }
  return { ...next, paperTree: { ...next.paperTree, nodes: next.paperTree.nodes.map((node) => node.id === graph.id ? { ...node, autoGraph: state } : node) } };
}

function validAnchors(project, plan, anchors) {
  const pages = new Map();
  for (const chunk of plan.chunks) {
    if (!pages.has(chunk.sourceId)) pages.set(chunk.sourceId, new Set());
    pages.get(chunk.sourceId).add(chunk.page);
  }
  return (Array.isArray(anchors) ? anchors : []).flatMap((anchor) => {
    const source = project.sources.find((item) => item.id === anchor?.sourceId);
    if (!source || !Number.isInteger(anchor.page) || !pages.get(source.id)?.has(anchor.page)) return [];
    return [{ sourceId: source.id, page: anchor.page, title: typeof anchor.title === "string" && anchor.title.trim() ? anchor.title : source.title,
      ...(typeof anchor.quote === "string" && anchor.quote ? { quote: anchor.quote } : {}) }];
  });
}

function unionAnchors(before, additions) {
  const result = [...(before || [])];
  const seen = new Set(result.map((anchor) => JSON.stringify([anchor.sourceId, anchor.page, anchor.quote || ""])));
  for (const anchor of additions) {
    const key = JSON.stringify([anchor.sourceId, anchor.page, anchor.quote || ""]);
    if (!seen.has(key)) { result.push(anchor); seen.add(key); }
  }
  return result;
}

/** Merge grounded concepts into canonical knowledge without replacing user edits. */
export function applyAutoGraphResult(project, plan, concepts, coverage) {
  if (!currentPlan(project, plan)) return project;
  const incoming = (Array.isArray(concepts) ? concepts : []).filter((concept) => concept && typeof concept.name === "string" && nameKey(concept.name));
  if (!incoming.length) return nextAutoGraphState(project, plan, { status: "error", error: "没有找到可生成图谱的知识点，请重试。" });
  const next = plan.graphId === "graph" ? normalizePaperTree(project) : ensureScopeGraph(project, plan.ownerId);
  const byId = new Map(next.concepts.map((concept) => [concept.id, concept]));
  const byName = new Map();
  for (const concept of next.concepts) if (!byName.has(nameKey(concept.name))) byName.set(nameKey(concept.name), concept.id);
  const idMap = new Map();
  const ambiguous = new Set();
  const resolved = [];
  for (const concept of incoming) {
    const key = nameKey(concept.name);
    let id = byName.get(key);
    if (!id) {
      // Keep canonical IDs within the generation API's 100-character bound.
      // A chapter owner may contain a full Unicode document path.
      const base = `auto:${hash(plan.graphId)}:${hash(key)}`;
      id = base;
      let suffix = 1;
      while (byId.has(id)) id = `${base}:${suffix++}`;
      const index = byId.size;
      byId.set(id, { id, name: concept.name.trim(), description: typeof concept.description === "string" ? concept.description : "",
        x: Number.isFinite(concept.x) ? concept.x : 160 + (index % 4) * 160,
        y: Number.isFinite(concept.y) ? concept.y : 100 + Math.floor(index / 4) * 120,
        group: Number.isFinite(concept.group) ? concept.group : 0, links: [] });
      byName.set(key, id);
    }
    if (typeof concept.id === "string" && concept.id) {
      if (idMap.has(concept.id) && idMap.get(concept.id) !== id) ambiguous.add(concept.id);
      else idMap.set(concept.id, id);
    }
    resolved.push({ concept, id });
  }
  for (const { concept, id } of resolved) {
    const before = byId.get(id);
    const additions = (Array.isArray(concept.links) ? concept.links : []).flatMap((link) => {
      if (typeof link !== "string" || ambiguous.has(link)) return [];
      const target = idMap.get(link) || (byId.has(link) ? link : null);
      return target && target !== id ? [target] : [];
    });
    const links = [...new Set([...(before.links || []), ...additions])];
    const anchors = unionAnchors(before.anchors, validAnchors(next, plan, concept.anchors));
    if (links.length !== (before.links || []).length || anchors.length !== (before.anchors || []).length)
      byId.set(id, { ...before, links, ...(anchors.length ? { anchors } : {}) });
  }
  const graph = nodeFor(next, plan.graphId);
  const ids = [...new Set([...(graph.conceptIds || []), ...resolved.map(({ id }) => id)])].filter((id) => byId.has(id));
  const merged = { ...next, concepts: [...byId.values()], paperTree: { ...next.paperTree, nodes: next.paperTree.nodes.map((node) =>
    node.id === plan.graphId && plan.graphId !== "graph" ? { ...node, conceptIds: ids } : node) } };
  return nextAutoGraphState(merged, plan, { status: "ready", ...(coverage ? { coverage } : {}) });
}
