import { resolvePaperObject } from "../paper-state.mjs";

function subset(items, ids) {
  if (ids === undefined) return items;
  const included = new Set(ids);
  return items.filter((item) => included.has(item.id));
}

/** Resolve live content once for any main, comparison or floating presentation.
 * Explicit empty memberships mean an empty collection, never the whole project.
 * Canonical tree references win over stale UI tabs without changing stored IDs.
 */
export function surfaceContent(project, target) {
  const node = project.paperTree?.nodes.find((item) => item.id === target.id);
  const reference = node || target;
  const setId = reference.kind === "questions" ? reference.objectId : undefined;
  const paper = reference.kind === "paper"
    ? project.papers?.find((item) => item.id === (reference.objectId || reference.id))
    : undefined;
  return {
    node,
    concepts: node?.graphConcepts ?? subset(project.concepts || [], node?.conceptIds),
    stages: subset(project.stages || [], node?.stageIds),
    sets: setId === undefined ? project.sets || [] : (project.sets || []).filter((set) => set.id === setId),
    setId,
    paper,
    object: paper ? resolvePaperObject(project, paper) : undefined,
  };
}

/** A scoped editor can only replace its collection; unrelated practice stays intact. */
export function replaceSurfaceSets(project, target, sets) {
  const { setId } = surfaceContent(project, target);
  return { ...project, sets: setId ? [...project.sets.filter((set) => set.id !== setId && !sets.some((item) => item.id === set.id)), ...sets] : sets };
}
