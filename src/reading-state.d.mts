import type { Project, Source } from "./types";
export function readingTarget(
  project: Project,
  currentSourceId?: string,
): Source | undefined;
export function readingPage(source: Source): number;
