import type { Concept } from './types';
import type { LearningRelationKind } from './learning-graph-layout.mjs';

export type RelationConcept = Pick<Concept, 'id' | 'name' | 'links'>;
export interface ConceptRelationGroup<T extends RelationConcept = Concept> {
  id: 'prerequisite' | 'dependent' | 'mutual' | 'related';
  label: string;
  concepts: T[];
}
/** Returns only direct neighbors, ordered as supplied; does not mutate input.
 * Cyclic direct neighbors are mutually related, never prior or subsequent.
 * Empty groups, self loops, invalid IDs and duplicate relations are omitted.
 */
export function buildConceptRelations<T extends RelationConcept>(
  concepts: readonly T[], activeId: string, relationKind?: LearningRelationKind,
): { groups: ConceptRelationGroup<T>[] };
