import type {
  Question,
  QuestionSet,
  LearningAttempt,
  LearningObject,
} from "./types";
export interface QuestionDraft {
  revision: string;
  answer: string;
  retry?: boolean;
  hint?: boolean;
}
export function questionRevision(question: Question): string;
export function questionView(
  objectId: string,
  question: Question,
  attempts?: LearningAttempt[],
  drafts?: Record<string, QuestionDraft>,
): {
  revision: string;
  answer: string;
  hint: boolean;
  retry: boolean;
  result?: LearningAttempt;
  assisted: boolean;
};
export function questionObject(
  setId: string,
  question: Question,
): LearningObject;
export function practiceSummary(
  set: QuestionSet,
  attempts?: LearningAttempt[],
  drafts?: Record<string, QuestionDraft>,
): {
  total: number;
  submitted: number;
  objectiveSubmitted: number;
  objectiveCorrect: number;
  selfReviewed: number;
  selfCorrect: number;
  needsReview: number;
  unanswered: number;
};
