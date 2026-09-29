import type { Source, Chunk } from "./types";
export function findSourcePages(sources: Source[], query: string, limit?: number): { s: Source; c: Chunk }[];
