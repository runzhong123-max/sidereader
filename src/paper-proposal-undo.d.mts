import type { Project } from "./types";
import type { ProjectUpdateReceipt } from "./project-updates.mjs";

export function revertPaperProposal(
  project: Project,
  receipt: ProjectUpdateReceipt,
  parentId: string,
  messageId: string,
): { project: Project; retained: number };
