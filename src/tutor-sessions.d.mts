import type { Concept, ReadingContext, ResearchStep } from "./types";
export type ConceptReference = Pick<Concept, "id" | "name" | "description" | "anchors">;
export const CONCEPT_DROP_MIME: "application/x-sidereader-object";
export const CONCEPT_DRAG_MARKER: "application/x-sidereader-concept";
export const MAX_CONCEPT_REFERENCES: number;
export function snapshotConceptReferences(ids: string[], concepts?: ConceptReference[]): ConceptReference[];
export function resolveConceptDrop(payload: unknown, projectId?: string, concepts?: ConceptReference[]): ConceptReference | null;
export function questionWithConceptReferences(question: string, references?: ConceptReference[]): string;
export interface TutorViewport {
  messageId?: string;
  blockIndex?: number;
  offset: number;
  scrollTop: number;
  followBottom: boolean;
  lastMessageId?: string;
}
export function snapshotReadingContext(
  context?: ReadingContext | null,
): ReadingContext | undefined;
export interface TutorSession {
  draft: string;
  conceptIds: string[];
  questionIds: string[];
  lastConceptDelivery?: string;
  lastQuestionDelivery?: string;
  busy: boolean;
  steps: ResearchStep[];
  lockedReading: { context: ReadingContext; pageImage: string } | null;
}
export interface TutorSessions {
  read(key: string): TutorSession;
  subscribe(key: string, listener: () => void): () => void;
  setDraft(key: string, draft: string): void;
  setConceptIds(key: string, ids: string[]): void;
  addConcept(key: string, id: string, deliveryKey?: string): "added" | "duplicate" | "full" | "handled" | "invalid";
  removeConcept(key: string, id: string): void;
  setQuestionIds(key: string, ids: string[]): void;
  addQuestion(key: string, id: string, deliveryKey?: string): "added" | "duplicate" | "full" | "handled" | "invalid";
  removeQuestion(key: string, id: string): void;
  readViewport(key: string): TutorViewport | undefined;
  saveViewport(key: string, viewport: TutorViewport): void;
  lockReading(key: string, context: ReadingContext | null, pageImage?: string): void;
  begin(key: string): AbortController | null;
  progress(key: string, controller: AbortController, step: ResearchStep): void;
  finish(key: string, controller: AbortController): void;
  stop(key: string): void;
}
export function createTutorSessions(
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): TutorSessions;
export const tutorSessions: TutorSessions;
