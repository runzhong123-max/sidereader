import { conversationOwner } from "./conversation-model.mjs";
import { chapterRange, createRelationIndex } from "./domain/relations.mjs";
import { practiceCatalog } from "./practice-catalog.mjs";

/** Reference membership comes from the receiving project's live objects, never
 * from a scope claimed by a drag payload or the PDF page currently on screen. */
export function referenceScope(project, scopeNodeId, practiceEntries = practiceCatalog(project)) {
  const data = createRelationIndex(project);
  const chapter = chapterRange(data, data.nodes.get(scopeNodeId)) ? data.nodes.get(scopeNodeId) : undefined;
  const scopeId = chapter?.id || "project";
  const conceptIds = new Set(chapter ? [] : (project.concepts || []).map((concept) => concept.id));
  for (const node of data.nodes.values()) {
    if (node.kind !== "graph") continue;
    const owner = conversationOwner(project, node.id);
    if ((owner?.role === "chapter" ? owner.id : "project") !== scopeId) continue;
    if (node.graphConcepts) for (const concept of node.graphConcepts) conceptIds.add(concept.id);
    else if (node.role === "scope-graph") for (const id of node.conceptIds || []) conceptIds.add(id);
  }
  return {
    scopeId,
    conceptIds: [...conceptIds],
    questionIds: [...new Set(practiceEntries.filter((entry) => entry.scopeId === scopeId).map((entry) => entry.id))],
  };
}

/** A saved draft is resolved against current scope membership before sending. */
export function filterScopeReferences(items, allowedIds) {
  if (allowedIds === undefined) return items;
  const allowed = new Set(allowedIds);
  return items.filter((item) => allowed.has(item.id));
}
