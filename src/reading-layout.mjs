import { conversationOwner } from "./conversation-model.mjs";

/** The PDF is the reading home; explicit drag placement can still override it. */
export function defaultReadingTarget(project, contextId = project.activeTab) {
  const nodes = project.paperTree?.nodes || [];
  const current = nodes.find((node) => node.id === contextId);
  if (current?.kind === "book" && project.sources.some((source) => source.id === current.sourceId)) return current;
  const owner = conversationOwner(project, contextId);
  if (owner?.role === "chapter" && project.sources.some((source) => source.id === owner.sourceId)) return owner;
  const source = project.sources.find((item) => item.id === project.activeSource && item.kind === "pdf")
    || project.sources.find((item) => item.kind === "pdf") || project.sources[0];
  return source ? nodes.find((node) => node.kind === "book" && node.role === "source" && node.sourceId === source.id) : undefined;
}

export function enterReadingProject(project) {
  const target = defaultReadingTarget(project);
  if (!target) return project;
  const source = project.sources.find((item) => item.id === target.sourceId);
  const start = target.anchor?.page || 1, end = target.endPage || source?.pages.length || start;
  const restorePage = target.role === "chapter" && (!source?.progress || source.progress < start || source.progress > end)
    ? Math.max(start, Math.min(end, target.progress || start)) : undefined;
  return { ...project, activeTab: target.id, activeSource: target.sourceId,
    sources: restorePage ? project.sources.map((item) => item.id === target.sourceId ? { ...item, progress: restorePage } : item) : project.sources,
    tabs: project.tabs.some((tab) => tab.id === target.id) ? project.tabs : [...project.tabs, target] };
}

export function readingCompanionKey(projectId, targetId) {
  return `${projectId}:${targetId}`;
}

/** Reading is the default, not a forced reset of an explicitly arranged workspace. */
export function restoreWorkspaceProject(project, mainId) {
  const target = mainId && project.paperTree?.nodes.find((node) => node.id === mainId);
  if (!target || target.kind === "book") return enterReadingProject(target ? { ...project, activeTab: target.id } : project);
  if (!["chat", "graph", "questions", "paper", "path"].includes(target.kind)) return enterReadingProject(project);
  return { ...project, activeTab: target.id,
    tabs: project.tabs.some((tab) => tab.id === target.id) ? project.tabs : [...project.tabs, target] };
}
