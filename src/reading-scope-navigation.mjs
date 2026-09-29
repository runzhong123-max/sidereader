import { conversationOwner } from "./conversation-model.mjs";
import { createRelationIndex, chapterRange } from "./domain/relations.mjs";
import { nodeTitle, scopeGraphId } from "./paper-tree-state.mjs";
import { practiceCatalog } from "./practice-catalog.mjs";

/** The project's reading entrance keeps the saved PDF identity. */
export function projectReadingRoot(project) {
  const data = createRelationIndex(project);
  const sources = [...data.nodes.values()].filter((node) => node.kind === "book" &&
    (node.role === "source" || (!node.role && node.id === `book:${node.sourceId}`)) && data.sources.has(node.sourceId));
  return sources.find((node) => data.sources.get(node.sourceId)?.kind === "pdf") || sources[0] || data.tutor;
}

/** Cards are a scope projection, never another level of conversation ancestry. */
export function scopeAttachments(project, scopeId, practiceEntries = practiceCatalog(project)) {
  const data = createRelationIndex(project);
  const scope = data.nodes.get(scopeId);
  const chapter = chapterRange(data, scope) ? scope : undefined;
  const scopeKey = (id) => chapterRange(data, data.nodes.get(id)) ? id : "project";
  const target = chapter?.id || "project";
  const graph = chapter
    ? [...data.nodes.values()].find((node) => node.kind === "graph" && node.role === "scope-graph" && node.parentId === chapter.id)
    : data.nodes.get("graph");
  const fallbackGraph = chapter
    ? { id: scopeGraphId(chapter.id), kind: "graph", role: "scope-graph", parentId: chapter.id, conceptIds: [] }
    : { id: "graph", kind: "graph", parentId: data.tutor?.id || project.paperTree?.rootId || null };
  const questions = [];
  const represented = new Set();
  const representedSets = new Set();
  for (const set of project.sets || []) {
    if (!set.questions?.length || representedSets.has(set.id)) continue;
    representedSets.add(set.id);
    for (const question of set.questions) represented.add(`question:${set.id}:${question.id}`);
    const node = [...data.nodes.values()].find((item) => item.kind === "questions" && item.objectId === set.id);
    const ownerId = set.scopeNodeId || (node ? conversationOwner(project, node.id)?.id : undefined);
    if (scopeKey(ownerId) !== target) continue;
    questions.push({
      node: node || { id: `questions:${set.id}`, kind: "questions", objectId: set.id, parentId: set.scopeNodeId || data.tutor?.id || null },
      title: set.title || (set.questions.length === 1 ? "随堂检测" : "习题"),
      count: set.questions.length,
    });
  }
  // Old answers could persist a question directly as a paper instead of a set.
  // Keep those attempts reachable, while avoiding a second card for saved sets.
  const papers = new Map((project.papers || []).map((paper) => [paper.id, paper]));
  for (const node of data.nodes.values()) {
    if (node.kind !== "paper") continue;
    const object = papers.get(node.objectId || node.id)?.object;
    if (object?.kind !== "question" || represented.has(object.id)) continue;
    represented.add(object.id);
    if (scopeKey(conversationOwner(project, node.id)?.id) !== target) continue;
    questions.push({ node, title: object.title || nodeTitle(project, node), count: 1 });
  }
  // Historical inline questions can exist only in an answer's Markdown. Their
  // original identity is enough for drag transfer; opening materializes its view.
  for (const entry of practiceEntries) {
    if (represented.has(entry.id) || entry.scopeId !== target) continue;
    represented.add(entry.id);
    questions.push({
      node: { id: entry.object.id, kind: "paper", objectId: entry.object.id, parentId: entry.originNodeId || data.tutor?.id || null },
      title: entry.object.title || entry.object.question?.prompt || "随堂检测",
      count: 1,
      practiceEntry: entry,
    });
  }
  return { graph: graph || fallbackGraph, graphMissing: !graph, questions };
}
