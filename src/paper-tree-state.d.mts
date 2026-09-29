import type { PaperNode, Project, ProjectProposal } from "./types";
import type { ProjectUpdateReceipt } from "./project-updates.mjs";

/** Throws for unknown tree versions rather than replacing future-version data. */
export function normalizePaperTree(project: Project): Project;
export function nodeTitle(project: Project, node: PaperNode): string;
/** Root-to-parent order; excludes the requested node itself. */
export function paperAncestors(project: Project, nodeId: string): PaperNode[];
/** Existing IDs retain their parent; new nodes do not activate a tab. */
export function attachPaperNode(project: Project, node: PaperNode): Project;
/** Deterministic identity of a chapter's independent graph. */
export function scopeGraphId(parentId: string): string;
/** Tutor uses the global graph; only chapters create independent graphs. */
export function ensureScopeGraph(project: Project, parentId: string): Project;
/** Index merged concepts in the owning chapter graph; project map/graph stay unique. */
export function addProposalNodes(
  project: Project,
  parentId: string,
  messageId: string,
  proposal: ProjectProposal,
  receipt?: ProjectUpdateReceipt,
): Project;
