import type { ReadingAnchor, WorkspaceTab } from "./types";
import type { ReaderSessionSnapshot } from "./reader-sessions.mjs";
export interface ReadingVisit {
  main: WorkspaceTab;
  companionId: string;
  comparisonOpen: boolean;
  side: "left" | "right";
  expanded: boolean;
  readers: Array<{ target: WorkspaceTab; key: string; comparison: boolean; page: number; session?: ReaderSessionSnapshot }>;
  evidenceText: string;
  referenceAnchors: Record<string, ReadingAnchor>;
}
export function createReadingHistory(limit?: number): {
  push(projectId: string, visit: ReadingVisit): void;
  peek(projectId: string): ReadingVisit | undefined;
  take(projectId: string, available?: (visit: ReadingVisit) => boolean): ReadingVisit | undefined;
};
