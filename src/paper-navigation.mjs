import { nodeTitle } from "./paper-tree-state.mjs";
import { conversationOwner, projectNavigationNodes } from "./conversation-model.mjs";
import { createRelationIndex, chapterForReading, chapterRange, readingSource, walkParents } from "./domain/relations.mjs";
import { surfaceDefinition } from "./domain/objects.mjs";
export { knowledgeGraphOwner } from "./knowledge-scope.mjs";

/** An empty project path starts in its existing tutor conversation. */
export function emptyProjectPathTutor(project, target) {
  if (target.id !== "path" || target.kind !== "path" || project.stages.length !== 0) return;
  return createRelationIndex(project).tutor;
}

/** Resolve an existing reading surface, without renumbering or changing the requested anchor. */
export function readingDestination(project, anchor, preferredId) {
  const relations = createRelationIndex(project), source = readingSource(relations, anchor);
  if (!source) return;
  return chapterForReading(relations, anchor, preferredId) || [...relations.nodes.values()].find((node) => node.kind === "book" && node.sourceId === source.id && (node.role === "source" || node.id === `book:${source.id}`));
}

function sourceOf(relations, node) {
  const { nodes, chats, sets } = relations;
  for (const current of walkParents(nodes, node?.id)) {
    if (current.kind === "questions" && current.objectId) {
      const set = sets.get(current.objectId);
      if (set?.scopeNodeId) return chapterRange(relations, nodes.get(set.scopeNodeId))?.source.id;
    }
    const context = current.kind === "chat" ? chats.get(current.objectId || current.id)?.context : undefined;
    if (context?.scopeNodeId) {
      // A stage is a project object, even when its first reference has a sourceId.
      return chapterRange(relations, nodes.get(context.scopeNodeId))?.source.id;
    }
    if (context?.reading) return readingSource(relations, context.reading)?.id;
    if (context?.sourceId) return relations.sources.get(context.sourceId)?.id;
    if (current.kind === "path" || current.role === "stage") return undefined;
    if (current.kind === "book") return current.sourceId;
  }
}

/** Reusable learning objects live on the shelf, independently of navigation ancestry. */
export function learningObjectNodes(project) {
  const { nodes, sets } = createRelationIndex(project);
  const papers = new Map((project.papers || []).map((paper) => [paper.id, paper]));
  const seenObjects = new Set();
  return [...nodes.values()].filter((node) => {
    const definition = surfaceDefinition(node.kind);
    if (!definition || node.role === "history") return false;
    if (node.kind === "paper") {
      const paper = papers.get(node.objectId || node.id);
      if (!paper?.object) return false;
      const identity = paper.object.id || node.objectId || node.id;
      if (seenObjects.has(identity)) return false;
      seenObjects.add(identity);
      return true;
    }
    if (node.id === node.kind) return true;
    if (node.kind === "graph" && node.role === "scope-graph") return conversationOwner(project, node.id)?.role === "chapter";
    if (node.kind !== "questions" || !node.objectId) return false;
    const set = sets.get(node.objectId);
    return !!set?.questions?.length && set.presentation !== "inline";
  });
}

/** Context first, then the same material, project objects, and other saved papers. */
export function relatedPaperOptions(project, primaryId) {
  const relations = createRelationIndex(project), { nodes } = relations;
  const primary = nodes.get(primaryId);
  const owner = conversationOwner(project, primaryId);
  const chapterId = owner?.role === "chapter" ? owner.id : undefined;
  const sourceId = sourceOf(relations, primary);
  const groups = ["本章", "这份资料", "项目", "其他内容"];
  const projectIds = new Set([project.paperTree?.tutorId, "graph", "path", "questions"]);
  const candidates = new Map([...projectNavigationNodes(project), ...learningObjectNodes(project)].map((node) => [node.id, node]));
  return [...candidates.values()].filter((node) => node.id !== primaryId && node.id !== project.paperTree?.rootId).map((node) => {
    const nodeOwner = conversationOwner(project, node.id);
    const group = chapterId && nodeOwner?.id === chapterId ? "本章"
      : sourceId && sourceOf(relations, nodes.get(node.id) || node) === sourceId ? "这份资料"
      : projectIds.has(node.id) || (node.kind === "questions" && nodeOwner?.id === project.paperTree?.tutorId) ? "项目" : "其他内容";
    let title = nodeTitle(project, node);
    if (node.kind === "graph") title = node.id === "graph" ? surfaceDefinition("graph").projectTitle
      : `${title} · ${nodeOwner?.role === "chapter" ? nodeTitle(project, nodeOwner) : "项目"}`;
    if (node.id === "path") title = surfaceDefinition("path").projectTitle;
    return { id: node.id, title, group };
  }).sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group));
}
