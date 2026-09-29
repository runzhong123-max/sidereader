import type { Project, Stage } from "./types";
export interface StageRemoval {
  stage: Stage;
  index: number;
  references: Array<{ id: string; before: string[]; after: string[] }>;
}
export function prerequisiteWouldCycle(
  stages: Stage[],
  stageId: string,
  prerequisiteId: string,
): boolean;
export function removeStage(project: Project, id: string): Project;
export function restoreRemovedStage(project: Project): Project;
