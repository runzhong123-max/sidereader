import type { Chat, PaperNode, Project, QuestionSet, ReadingAnchor, Source } from "../types";

export function indexById<T extends { id: string }>(items?: readonly T[]): Map<string, T>;
export function traceChain<T extends { id: string }>(start: T | undefined, next: (node: T) => T | undefined): { nodes: T[]; cycleStart: number };
export function walkParents<T extends { id: string; parentId?: string | null }>(nodes: ReadonlyMap<string, T>, nodeId?: string): IterableIterator<T>;
export function parentChain<T extends { id: string; parentId?: string | null }>(nodes: ReadonlyMap<string, T>, nodeId?: string): T[];
export function hasDirectedPath(startId: string, targetId: string, successors: (id: string) => Iterable<string> | undefined): boolean;
export interface RelationIndex {
  nodes: Map<string, PaperNode>;
  tutor: PaperNode | undefined;
  sources: Map<string, Source>;
  chats: Map<string, Chat>;
  sets: Map<string, QuestionSet>;
}
export function createRelationIndex(project: Project): RelationIndex;
export function readingSource(relations: RelationIndex, anchor?: ReadingAnchor): Source | undefined;
export function chapterRange(relations: RelationIndex, node?: PaperNode): { source: Source; start: number; end: number } | undefined;
export function chapterForReading(relations: RelationIndex, anchor?: ReadingAnchor, preferredId?: string): PaperNode | undefined;
