import type { Project, PaperNode } from "./types";
export function defaultReadingTarget(project: Project, contextId?: string): PaperNode | undefined;
export function enterReadingProject(project: Project): Project;
export function readingCompanionKey(projectId: string, targetId: string): string;
export function restoreWorkspaceProject(project: Project, mainId?: string): Project;
