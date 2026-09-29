import type { Concept, Project, ProjectProposal, Stage } from "./types";
export interface ProjectUpdateReceipt {
  concepts: Array<{ id: string; before?: Concept; after: Concept }>;
  stages: Array<{ id: string; before?: Stage; after: Stage }>;
}
export function mergeProjectUpdate(
  project: Project,
  proposal: ProjectProposal,
): Project;
export function createProjectUpdate(
  project: Project,
  proposal: ProjectProposal,
): { project: Project; receipt: ProjectUpdateReceipt };
export function revertProjectUpdate(
  project: Project,
  receipt: ProjectUpdateReceipt,
): { project: Project; retained: number };
