import { attachPaperNode } from "./paper-tree-state.mjs";

export function conversationGraphNodeId(parentId, graphId) {
  return `conversation-graph:${encodeURIComponent(parentId)}:${encodeURIComponent(graphId)}`;
}

/** Register immutable conversation output without updating the textbook graph. */
export function captureConversationGraphs(project, parentId, message) {
  if (message.role !== "assistant" || message.error || !project.paperTree?.nodes.some((node) => node.id === parentId)) return project;
  let next = project;
  for (const graph of message.conversationGraphs || []) {
    if (!graph?.id || !graph.title?.trim() || !Array.isArray(graph.concepts) || !graph.concepts.length) continue;
    const id = conversationGraphNodeId(parentId, graph.id);
    if (next.paperTree.nodes.some((node) => node.id === id)) continue;
    next = attachPaperNode(next, {
      id, kind: "graph", objectId: graph.id, parentId, sourceMessageId: message.id,
      title: graph.title, origin: "tool", graphConcepts: structuredClone(graph.concepts),
    });
  }
  return next;
}

/** Reopening a saved project restores missing addresses, never duplicates objects. */
export function restoreConversationGraphs(project) {
  let next = project;
  for (const chat of project.chats || []) {
    const parent = next.paperTree?.nodes.find((node) => node.kind === "chat" && (node.objectId || node.id) === chat.id);
    if (!parent) continue;
    for (const message of chat.messages || []) next = captureConversationGraphs(next, parent.id, message);
  }
  return next;
}
