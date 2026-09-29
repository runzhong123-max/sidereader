import type { Project } from "./types";
import type { PracticeEntry } from "./practice-catalog.mjs";

export interface ReferenceScope {
  scopeId: string;
  conceptIds: string[];
  questionIds: string[];
}
export function referenceScope(project: Project, scopeNodeId?: string, practiceEntries?: PracticeEntry[]): ReferenceScope;
export function filterScopeReferences<T extends { id: string }>(items: T[], allowedIds?: string[]): T[];
