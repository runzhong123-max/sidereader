export function nodeConversation(project, node) {
  return node?.kind === "chat" ? project.chats.find((chat) => chat.id === (node.objectId || node.id)) : undefined;
}

/** A discussion belongs to a learning node; opening another page never moves it. */
export function discussionScope(project, parentId) {
  const nodes = project.paperTree?.nodes || [];
  const visited = new Set();
  let node = nodes.find((item) => item.id === parentId);
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    const chat = nodeConversation(project,node);
    if (chat?.context?.scopeNodeId || chat?.context?.sourceId || chat?.context?.reading?.sourceId)
      return { scopeNodeId: chat.context.scopeNodeId, sourceId: chat.context.sourceId || chat.context.reading?.sourceId };
    if (node.role === "chapter" || node.role === "stage")
      return { scopeNodeId: node.id, sourceId: node.sourceId };
    if (node.kind === "book") return { sourceId: node.sourceId };
    node = nodes.find((item) => item.id === node.parentId);
  }
  return {};
}

export function discussionSources(project, scope = {}) {
  const node = project.paperTree?.nodes.find((item) => item.id === scope.scopeNodeId);
  if (node?.role === "chapter") {
    const source = project.sources.find((item) => item.id === node.sourceId);
    if (!source) return [];
    const start = node.anchor?.page || 1;
    const end = node.endPage || source.pages.length;
    // Keep physical page indices intact so citations still open the original PDF.
    return [{ ...source, pages: source.pages.map((text, i) => i + 1 >= start && i + 1 <= end ? text : ""),
      chunks: source.chunks.filter((chunk) => chunk.page >= start && chunk.page <= end) }];
  }
  if (node?.role === "stage") {
    const stage = project.stages.find((item) => item.id === node.stageId);
    const ids = new Set((stage?.anchors || []).map((anchor) => anchor.sourceId));
    if (ids.size) return project.sources.filter((source) => ids.has(source.id));
  }
  return scope.sourceId ? project.sources.filter((source) => source.id === scope.sourceId) : project.sources;
}
