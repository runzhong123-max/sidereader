import type { PaperNode, Project, ReadingAnchor, WorkspaceTab } from "./types";
export { knowledgeGraphOwner } from "./knowledge-scope.mjs";

/** Existing project tutor when opening the canonical project path before any stages exist. */
export function emptyProjectPathTutor(project: Project, target: WorkspaceTab): PaperNode | undefined;

/** Existing chapter containing the physical page, or the existing whole-source node. */
export function readingDestination(project: Project, anchor: ReadingAnchor, preferredId?: string): PaperNode | undefined;
/** Saved learning objects, canonical graphs/map, practice overview and nonempty collections; inline-only checks stay in their originating paper. */
export function learningObjectNodes(project: Project): PaperNode[];
export interface RelatedPaperOption {
  id: string;
  title: string;
  group: "本章" | "这份资料" | "项目" | "其他纸张" | "当前对话";
}
export function relatedPaperOptions(project: Project, primaryId: string): RelatedPaperOption[];
