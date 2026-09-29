import type { LearningGraph, LearningNode } from './learning-graph-layout.mjs';
/** Temporarily gives the selected 1–3-hop undirected neighborhood more room.
 * Focus and outside nodes remain fixed; labels move with their nodes.
 * Fixed-to-fixed collisions cannot be repaired without violating that contract.
 * Calling with the same base graph is deterministic; input is never changed.
 */
export function relaxLearningNeighborhood(graph: LearningGraph, focusId: string, depth: number): LearningNode[];
