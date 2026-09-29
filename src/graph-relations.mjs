function reachableFrom(start, adjacency) {
  const reached = new Set([start]), pending = [start];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    for (const id of adjacency.get(pending[cursor])) if (!reached.has(id)) {
      reached.add(id);
      pending.push(id);
    }
  }
  return reached;
}

/** Describe only stored, direct relations; no geometry or inferred links.
 * Chapter links name prerequisites. Related graphs treat either direction as
 * an association. Input order is retained within each group.
 */
export function buildConceptRelations(concepts, activeId, relationKind = 'prerequisite') {
  const records = new Map();
  for (const concept of concepts) if (concept?.id && !records.has(concept.id)) records.set(concept.id, concept);
  if (!records.has(activeId)) return { groups: [] };

  const before = new Map(), after = new Map();
  for (const id of records.keys()) { before.set(id, new Set()); after.set(id, new Set()); }
  for (const [id, concept] of records) for (const link of concept.links || []) {
    if (link === id || !records.has(link)) continue;
    before.get(id).add(link);
    after.get(link).add(id);
  }
  const directBefore = before.get(activeId), directAfter = after.get(activeId);
  const neighbors = new Set([...directBefore, ...directAfter]);
  const group = (id, label, include) => ({ id, label, concepts: [...records.values()].filter(concept => include(concept.id)) });
  if (relationKind === 'related') {
    const related = group('related', '关联概念', id => neighbors.has(id));
    return { groups: related.concepts.length ? [related] : [] };
  }

  // Mutual reachability identifies the active strongly connected component in
  // O(V + E), without running the visual layout or recursively walking a chain.
  const predecessors = reachableFrom(activeId, before), successors = reachableFrom(activeId, after);
  const mutual = new Set([...neighbors].filter(id => predecessors.has(id) && successors.has(id)));
  return { groups: [
    group('prerequisite', '直接先修', id => directBefore.has(id) && !mutual.has(id)),
    group('mutual', '相互关联', id => mutual.has(id)),
    group('dependent', '直接后续', id => directAfter.has(id) && !mutual.has(id)),
  ].filter(item => item.concepts.length) };
}
