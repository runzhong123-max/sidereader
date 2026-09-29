import type { Concept } from './types';
import type { Camera } from './graph-layout.mjs';
export type LearningLayoutMode = 'core' | 'layers' | 'network';
export type LearningGraphMode = LearningLayoutMode;
export type LearningRelationKind = 'prerequisite' | 'related';
export interface LearningNode {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  degree: number;
  depth: number;
  parentId?: string;
  rootId: string;
  componentId: string;
  layer: number;
  isRoot: boolean;
  childIds: string[];
  side: -1 | 0 | 1;
  /** Relative to the dot; x/y specify the label's top-left corner. */
  label: { x: number; y: number; width: number; height: number; lines: string[]; fontSize: number; lineHeight: number };
  /** Relative to the dot; includes a 34px expansion control allowance only in core mode. */
  bounds: { left: number; top: number; right: number; bottom: number };
}
export interface LearningEdge {
  key: string;
  source: string;
  target: string;
  relationKind: LearningRelationKind;
  tree: boolean;
  cycle: boolean;
}
export interface LearningGraph {
  mode: LearningGraphMode;
  relationKind: LearningRelationKind;
  nodes: LearningNode[];
  edges: LearningEdge[];
  roots: string[];
  components: { id: string; nodeIds: string[]; cyclic: boolean; layer: number }[];
  maxDepth: number;
  /** Conflicting manual pins are reported, never silently moved. */
  pinConflicts: [string, string][];
}
export interface LearningGraphOptions {
  mode?: LearningGraphMode;
  relationKind?: LearningRelationKind;
  rootId?: string | null;
  /** Dimensionless spacing factor, clamped to 0.65–2; defaults to 1. */
  spread?: number;
  /** Applied only to network layout; defaults to false. */
  usePins?: boolean;
}
export function buildLearningGraph(concepts: Pick<Concept, 'id' | 'name' | 'links' | 'layout'>[], options?: LearningGraphOptions): LearningGraph;
export function learningGraphBounds(nodes: LearningNode[]): { left: number; top: number; right: number; bottom: number; width: number; height: number };
export function fitLearningGraph(nodes: LearningNode[], width: number, height: number, options?: { top?: number; bottom?: number; padding?: number; maxScale?: number }): Camera;
export function learningEdgePath(edge: LearningEdge, nodesById: Map<string, LearningNode> | LearningNode[]): string;
