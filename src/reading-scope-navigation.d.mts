import type { PaperNode, Project } from "./types";
import type { PracticeEntry } from "./practice-catalog.mjs";

export interface ScopeQuestionCard {
  node: PaperNode;
  title: string;
  count: number;
  practiceEntry?: PracticeEntry;
}
export function projectReadingRoot(project: Project): PaperNode | undefined;
export function scopeAttachments(project: Project, scopeId: string, practiceEntries?: PracticeEntry[]): {
  graph: PaperNode;
  graphMissing: boolean;
  questions: ScopeQuestionCard[];
};
