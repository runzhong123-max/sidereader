import type { Concept, LearningObject, Paper, PaperNode, Project, QuestionSet, Stage, WorkspaceTab } from "./types";
export interface LearningSurfaceContent {
  node: PaperNode | undefined;
  concepts: Concept[];
  stages: Stage[];
  sets: QuestionSet[];
  setId: string | undefined;
  paper: Paper | undefined;
  object: LearningObject | undefined;
}
export function surfaceContent(project: Project, target: WorkspaceTab): LearningSurfaceContent;
export function replaceSurfaceSets(project: Project, target: WorkspaceTab, sets: QuestionSet[]): Project;
