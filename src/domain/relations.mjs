/**
 * Shared relation primitives. Containment/provenance, stage prerequisites and
 * concept associations are distinct relations; only the first two require a
 * partial order. Reading or projecting a relation never rewrites its edges.
 */

/** First stored identity wins, matching normalization and preserving order. */
export function indexById(items = []) {
  const result = new Map();
  for (const item of items) if (!result.has(item.id)) result.set(item.id, item);
  return result;
}

function* walkChain(start, next) {
  const seen = new Set();
  let current = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    yield current;
    current = next(current);
  }
  return current;
}

/** Trace one-parent relations safely, reporting (rather than repairing) a cycle. */
export function traceChain(start, next) {
  const nodes = [], iterator = walkChain(start, next);
  let step = iterator.next();
  while (!step.done) { nodes.push(step.value); step = iterator.next(); }
  return { nodes, cycleStart: step.value ? nodes.findIndex((node) => node.id === step.value.id) : -1 };
}

/** Lazy ancestry lets ownership queries stop as soon as their boundary is found. */
export function* walkParents(nodes, nodeId) {
  return yield* walkChain(nodes.get(nodeId), (node) => nodes.get(node.parentId));
}

/** Node-to-root order, including self; missing parents terminate the chain. */
export function parentChain(nodes, nodeId) {
  return [...walkParents(nodes, nodeId)];
}

/** Reachability for a directed relation. Cycles terminate without changing it. */
export function hasDirectedPath(startId, targetId, successors) {
  const stack = [startId], visited = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (id === targetId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of successors(id) || []) if (!visited.has(next)) stack.push(next);
  }
  return false;
}

/** One consistent identity lookup for all location and ownership projections. */
export function createRelationIndex(project) {
  const nodes = indexById(project.paperTree?.nodes);
  const tutor = nodes.get(project.paperTree?.tutorId);
  return {
    nodes, tutor: tutor?.kind === "chat" ? tutor : undefined,
    sources: indexById(project.sources), chats: indexById(project.chats), sets: indexById(project.sets),
  };
}

/** Physical pages are validated, never clamped or inferred from reading progress. */
export function readingSource(relations, anchor) {
  const source = relations.sources.get(anchor?.sourceId);
  return source && Number.isInteger(anchor?.page) && anchor.page >= 1 && anchor.page <= source.pages.length ? source : undefined;
}

export function chapterRange(relations, node) {
  if (node?.kind !== "book" || node.role !== "chapter") return;
  const source = relations.sources.get(node.sourceId);
  const start = node.anchor?.page, end = node.endPage ?? source?.pages.length;
  if (!source || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > source.pages.length) return;
  // A stale cross-source anchor is not a valid chapter location.
  if (node.anchor?.sourceId && node.anchor.sourceId !== source.id) return;
  return { source, start, end };
}

/** Preferred containing chapter, then narrowest range, deepest node, stored order. */
export function chapterForReading(relations, anchor, preferredId) {
  const source = readingSource(relations, anchor);
  if (!source) return;
  const matches = (node) => {
    const range = chapterRange(relations, node);
    return range?.source.id === source.id && anchor.page >= range.start && anchor.page <= range.end;
  };
  const preferred = relations.nodes.get(preferredId);
  if (matches(preferred)) return preferred;
  return [...relations.nodes.values()].filter(matches).map((node) => ({
    node, range: chapterRange(relations, node), depth: parentChain(relations.nodes, node.id).length,
  })).sort((a, b) => (a.range.end - a.range.start) - (b.range.end - b.range.start) || b.depth - a.depth)[0]?.node;
}
