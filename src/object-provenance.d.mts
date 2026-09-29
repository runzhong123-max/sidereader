import type { PaperNode, Project, QuestionSet } from "./types";
export function questionOriginLabel(set: QuestionSet): string;
export function objectScopeLabel(project: Project, nodeId?: string): string;
export function graphProvenance(project: Project, node?: PaperNode): {
  label: string;
  scope: string;
  origin?: PaperNode;
  originTitle?: string;
};
