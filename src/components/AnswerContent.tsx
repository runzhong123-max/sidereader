import { useMemo } from "react";
import AnswerMarkdown, { CopyButton } from "./AnswerMarkdown";
import LearningObjectCard from "./LearningObjectCard";
import AnswerFragment from "./AnswerFragment";
import { parseAnswer, answerForPaper } from "../learning-objects.mjs";
import type { Evidence, LearningAttempt, LearningObject } from "../types";
import type { QuestionDraft } from "../question-state.mjs";
export default function AnswerContent({
  content,
  messageId,
  evidence,
  onCitation,
  onOpen,
  attempts,
  onAttempt,
  drafts,
  onDraft,
  projectId,
  objectReferences,
  onReferenceQuestion,
}: {
  content: string;
  messageId: string;
  evidence: Evidence[];
  onCitation: (e: Evidence) => void;
  onOpen?: (o: LearningObject) => void;
  attempts?: LearningAttempt[];
  onAttempt?: (a: LearningAttempt) => void;
  drafts?: Record<string, QuestionDraft>;
  onDraft?: (objectId: string, draft: QuestionDraft) => void;
  projectId?: string;
  objectReferences?: Record<string, string>;
  onReferenceQuestion?: (object: LearningObject) => void;
}) {
  const parts = useMemo(
    () => parseAnswer(content, messageId),
    [content, messageId],
  );
  return (
    <>
      {parts.map((part, i) =>
        part.object && ["formula", "table", "code", "pseudocode", "ascii"].includes(part.object.kind) ? (
          <AnswerFragment key={part.object.id} object={part.object} projectId={projectId} workspaceNodeId={objectReferences?.[part.object.id]}
            evidence={evidence} onCitation={onCitation} onOpen={onOpen}/>
        ) : part.object ? (
          <LearningObjectCard
            key={part.object.id}
            object={part.object}
            projectId={projectId}
            workspaceNodeId={objectReferences?.[part.object.id]}
            evidence={evidence}
            onCitation={onCitation}
            onOpen={onOpen}
            onReferenceQuestion={onReferenceQuestion}
            attempts={attempts}
            onAttempt={onAttempt}
            drafts={drafts}
            onDraft={onDraft}
          />
        ) : (
          <AnswerMarkdown
            key={i}
            showCopy={false}
            content={part.text}
            evidence={evidence}
            onCitation={onCitation}
          />
        ),
      )}
      <CopyButton value={() => answerForPaper(content, messageId)} />
    </>
  );
}
