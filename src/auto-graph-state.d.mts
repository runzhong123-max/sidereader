import type { Chunk, Concept, GraphCoverage, PaperNode, Project } from "./types";

export interface AutoGraphPlan {
  graphId: string;
  ownerId: string;
  fingerprint: string;
  scope: { kind: "project" | "chapter"; title: string; description?: string };
  chunks: Chunk[];
}
export type AutoGraphState = NonNullable<PaperNode["autoGraph"]>;
export function autoGraphPlan(project: Project, activeNodeId: string): AutoGraphPlan | null;
export function shouldGenerateGraph(project: Project, plan: AutoGraphPlan | null): boolean;
export function nextAutoGraphState(project: Project, plan: AutoGraphPlan, update: Partial<AutoGraphState> & Pick<AutoGraphState, "status">): Project;
export function applyAutoGraphResult(project: Project, plan: AutoGraphPlan, concepts: Concept[], coverage?: GraphCoverage): Project;
