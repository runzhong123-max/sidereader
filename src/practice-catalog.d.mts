import type { Evidence, LearningObject, Project } from "./types";

export interface PracticeEntry {
  id: string;
  object: LearningObject;
  originNodeId?: string;
  sourceMessageId?: string;
  originTitle: string;
  scopeId: string;
  scopeTitle: string;
  setId?: string;
  evidence: Evidence[];
  status: "unanswered" | "review" | "answered";
  statusLabel: string;
}

export function practiceCatalog(project: Project): PracticeEntry[];
