export type LearningObjectKind =
  | "code" | "pseudocode" | "ascii" | "plot" | "table" | "formula"
  | "question" | "trace" | "concept" | "source" | "tool" | "note";
export type LearningSurfaceKind = "graph" | "path" | "questions" | "paper";
export type ObjectRenderer = "markdown" | "code" | "formula" | "question" | "plot" | "trace";
export interface ObjectDefinition {
  readonly kind: LearningObjectKind;
  readonly label: string;
  readonly renderer: ObjectRenderer;
  readonly canCompare: boolean;
  readonly canFloat: boolean;
}
export interface SurfaceDefinition {
  readonly kind: LearningSurfaceKind;
  readonly title: string;
  readonly projectTitle: string;
  readonly scope: "project" | "project-and-chapter" | "origin";
  readonly icon: "network" | "route" | "practice" | "object";
  readonly canCompare: boolean;
  readonly canFloat: boolean;
}
export const objectDefinitions: Readonly<Record<LearningObjectKind, ObjectDefinition>>;
export const objectLabels: Readonly<Record<LearningObjectKind, string>>;
export const surfaceDefinitions: Readonly<Record<LearningSurfaceKind, SurfaceDefinition>>;
export function objectDefinition(kind: LearningObjectKind): ObjectDefinition;
export function objectDefinition(kind: unknown): ObjectDefinition | undefined;
export function surfaceDefinition(kind: LearningSurfaceKind): SurfaceDefinition;
export function surfaceDefinition(kind: unknown): SurfaceDefinition | undefined;
