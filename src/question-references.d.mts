import type { LearningObject, Question } from "./types";
export interface QuestionReference {
  id: string;
  title: string;
  question: Pick<Question, "type" | "prompt" | "options" | "sourceQuestionNumber" | "anchors">;
}
export const QUESTION_DROP_MIME: "application/x-sidereader-question";
export const MAX_QUESTION_REFERENCES: number;
export function questionReferenceIds(ids: string[]): string[];
export function snapshotQuestionReferences(ids: string[], objects?: Array<LearningObject | QuestionReference>): QuestionReference[];
export function resolveQuestionDrop(payload: unknown, projectId?: string, objects?: Array<LearningObject | QuestionReference>): QuestionReference | null;
export function writeQuestionTransfer(dataTransfer: DataTransfer, projectId: string, questionId: string): void;
export function questionWithQuestionReferences(text: string, references?: QuestionReference[]): string;
