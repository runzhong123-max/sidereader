import type { Bookmark, Project, Source, WorkspaceTarget } from "./types";
export function documentForTarget(project: Project, target?: WorkspaceTarget): Source | undefined;
export function documentPage(source?: Source, requested?: number): number;
export function recordDocumentPosition(project: Project, target: WorkspaceTarget, page: number): Project;
export function pageBookmark(project: Project, sourceId: string, page: number): Bookmark | undefined;
export function saveDocumentBookmark(project: Project, bookmark: Bookmark): Project;
export function toggleDocumentBookmark(project: Project, bookmark: Bookmark): Project;
export function removeDocument(project: Project, sourceId: string): Project;
