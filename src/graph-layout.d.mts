import type { Concept } from "./types";
export interface GraphNode {
  id: string;
  x: number;
  y: number;
  r: number;
  degree: number;
}
export interface Camera {
  x: number;
  y: number;
  k: number;
}
export function graphData(concepts: Concept[]): {
  edges: { source: string; target: string; key: string }[];
  neighbors: Map<string, Set<string>>;
};
export function neighborhood(
  neighbors: Map<string, Set<string>>,
  id: string | null,
  depth?: number,
): Set<string>;
export function layoutGraph(concepts: Concept[], spread?: number): GraphNode[];
export function fitGraph(
  nodes: GraphNode[],
  width: number,
  height: number,
  padding?: number,
): Camera;
export interface GraphLabel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  lines: string[];
  nodeX: number;
  nodeY: number;
  leader?: { x: number; y: number };
}
export function graphLabelLines(name: string, maxWidth?: number, fontSize?: number): string[];
export function placeGraphLabels(
  nodes: (GraphNode & { name: string })[], camera: Camera, width: number, height: number,
  options?: { top?: number; bottom?: number },
): Map<string, GraphLabel>;
