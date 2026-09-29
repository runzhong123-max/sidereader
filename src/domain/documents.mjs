import { sameBookmarkExcerpt } from "../reader-selection.mjs";

/** Source files own text/index/progress. Chapters and bookmarks address the same file. */
export function documentForTarget(project, target) {
  const reference = project.paperTree?.nodes.find((node) => node.id === target?.id) || target;
  return reference?.kind === "book" ? project.sources.find((source) => source.id === reference.sourceId) : undefined;
}

export function documentPage(source, requested = source?.progress) {
  return Math.max(1, Math.min(Math.floor(requested) || 1, source?.pages.length || 1));
}

/** Reading progress changes content location, never a conversation's saved context. */
export function recordDocumentPosition(project, target, page) {
  const source = documentForTarget(project, target);
  if (!source) return project;
  const next = documentPage(source, page);
  return {
    ...project,
    activeSource: source.id,
    sources: project.sources.map((item) => item.id === source.id ? { ...item, progress: next } : item),
    paperTree: project.paperTree && {
      ...project.paperTree,
      nodes: project.paperTree.nodes.map((node) => node.id === target.id && node.role === "chapter" ? { ...node, progress: next } : node),
    },
  };
}

export function pageBookmark(project, sourceId, page) {
  return project.bookmarks?.find((bookmark) => bookmark.sourceId === sourceId && bookmark.page === page && !bookmark.quote?.trim());
}

/** A page marker and multiple excerpts can coexist at the same position. */
export function saveDocumentBookmark(project, bookmark) {
  const source = project.sources.find((item) => item.id === bookmark.sourceId);
  if (!source || documentPage(source, bookmark.page) !== bookmark.page) return project;
  const duplicate = project.bookmarks?.some((item) => item.sourceId === bookmark.sourceId && item.page === bookmark.page && sameBookmarkExcerpt(item.quote, bookmark.quote));
  return duplicate ? project : { ...project, bookmarks: [...(project.bookmarks || []), bookmark] };
}

export function toggleDocumentBookmark(project, bookmark) {
  const existing = pageBookmark(project, bookmark.sourceId, bookmark.page);
  return existing ? { ...project, bookmarks: project.bookmarks.filter((item) => item.id !== existing.id) }
    : saveDocumentBookmark(project, { ...bookmark, quote: undefined });
}

/** Remove the imported file reference only. Provenance and learning records survive. */
export function removeDocument(project, sourceId) {
  if (!project.sources.some((source) => source.id === sourceId)) return project;
  const removedIds = new Set((project.paperTree?.nodes || []).filter((node) => node.kind === "book" && node.sourceId === sourceId).map((node) => node.id));
  const tabs = project.tabs.filter((tab) => !removedIds.has(tab.id) && !(tab.kind === "book" && tab.sourceId === sourceId));
  const tutor = project.paperTree?.nodes.find((node) => node.id === project.paperTree.tutorId);
  const remainingTabs = tabs.length ? tabs : tutor ? [tutor] : [];
  const sources = project.sources.filter((source) => source.id !== sourceId);
  return { ...project, sources, tabs: remainingTabs,
    activeSource: project.activeSource === sourceId ? sources[0]?.id || "" : project.activeSource,
    activeTab: remainingTabs.some((tab) => tab.id === project.activeTab) ? project.activeTab : remainingTabs[0]?.id || "",
  };
}
