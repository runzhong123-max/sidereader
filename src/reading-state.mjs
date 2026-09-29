import { documentPage } from "./domain/documents.mjs";
// A project remembers its reading source independently from the active tab.
export function readingTarget(project, currentSourceId) {
  return (
    project.sources.find((s) => s.id === currentSourceId) ||
    project.sources.find((s) => s.id === project.activeSource) ||
    [...project.tabs]
      .reverse()
      .map((t) =>
        project.sources.find((s) => t.kind === "book" && s.id === t.sourceId),
      )
      .find(Boolean) ||
    project.sources[0]
  );
}
export const readingPage = documentPage;
