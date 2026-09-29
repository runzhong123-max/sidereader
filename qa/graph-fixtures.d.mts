import type { Concept } from "../src/types";
export type GraphFixtureId = "chapter" | "cycle" | "disconnected" | "hundred" | "far-pin";
export interface GraphFixture {
  id: GraphFixtureId;
  title: string;
  description: string;
  relationKind: "prerequisite" | "related";
  concepts: Concept[];
  checks: string[];
}
export const GRAPH_FIXTURE_IDS: GraphFixtureId[];
export const graphFixtureChoices: { id: GraphFixtureId; title: string }[];
export function graphFixture(id?: string): GraphFixture;
