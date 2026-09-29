import type { Project, Paper, LearningAttempt, LearningObject } from "./types";
export function resolvePaperObject(
  project: Project,
  paper: Paper,
): LearningObject;
export function openPaper(project: Project, paper: Paper): Project;
export function addAttempt(project: Project, attempt: LearningAttempt): Project;
