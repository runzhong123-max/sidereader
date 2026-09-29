import type { LearningObject, LearningAttempt, Question } from "./types";
export { objectLabels } from "./domain/objects.mjs";
export function normalizeObject(
  raw: unknown,
  id: string,
): LearningObject | null;
export function parseAnswer(
  content: string,
  messageId: string,
): (
  | { text: string; object?: never }
  | { object: LearningObject; text?: never }
)[];
export function gradeQuestion(
  question: Question,
  answer: string,
  action?: string,
): LearningAttempt["result"] | "unanswered";
export function attemptContext(attempts: unknown): unknown[];
export function answerForPaper(content: string, messageId: string): string;
export function objectMarkdown(object: LearningObject): string;
