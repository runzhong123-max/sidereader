import { ArrowUpRight, FileQuestion } from "lucide-react";
import type { Evidence, LearningAttempt, LearningObject, QuestionSet, ReadingAnchor } from "../types";
import type { QuestionDraft } from "../question-state.mjs";
import { questionObject } from "../question-state.mjs";
import LearningObjectCard from "./LearningObjectCard";
import { writeWorkspaceTransfer } from "../object-transfer.mjs";
import { questionOriginLabel } from "../object-provenance.mjs";
import ObjectContext from "./ObjectContext";

/** Tool receipts open saved collections; short checks remain directly answerable. */
export default function PracticeMessage({ sets, evidence, attempts, drafts, onAttempt, onDraft, onCitation, onOpen, onOpenObject, projectId, objectReferences, onReferenceQuestion, onReadAnchor }: {
  sets: QuestionSet[];
  evidence: Evidence[];
  attempts?: LearningAttempt[];
  drafts?: Record<string, QuestionDraft>;
  onAttempt?: (attempt: LearningAttempt) => void;
  onDraft?: (objectId: string, draft: QuestionDraft) => void;
  onCitation: (evidence: Evidence) => void;
  onOpen?: (setId: string) => void;
  onOpenObject?: (object: LearningObject) => void;
  onReferenceQuestion?: (object: LearningObject) => void;
  onReadAnchor?: (anchor: ReadingAnchor) => void;
  projectId?: string;
  objectReferences?: Record<string, string>;
}) {
  return <>{sets.map((set) => set.presentation === "inline"
    ? <div className="practice-inline-check" key={set.id}>
      <ObjectContext label={questionOriginLabel(set)} scope="本次对话"/>
      {set.origin === "textbook" && Boolean(set.anchors?.length) && <div className="practice-file-meta">{set.anchors!.map((anchor) => <button type="button" key={`${anchor.sourceId}:${anchor.page}`} className="text-button" disabled={!onReadAnchor} onClick={() => onReadAnchor?.(anchor)}>{anchor.title} · 第 {anchor.page} 页</button>)}</div>}
      {set.questions.map((question) =>
      <LearningObjectCard key={question.id} object={questionObject(set.id, question)} evidence={evidence}
        projectId={projectId} workspaceNodeId={objectReferences?.[questionObject(set.id, question).id]}
        onOpen={onOpenObject}
        onReferenceQuestion={onReferenceQuestion}
        attempts={attempts} drafts={drafts} onAttempt={onAttempt} onDraft={onDraft} onCitation={onCitation}/>)}</div>
    : <button key={set.id} className="practice-receipt" onClick={() => onOpen?.(set.id)} disabled={!onOpen}>
      <FileQuestion size={20}/><span><strong
        draggable={Boolean(projectId)}
        title={projectId ? "点击或拖出卡片" : undefined}
        style={projectId ? { cursor: "grab" } : undefined}
        onDragStart={(event) => {
          if (!projectId) return;
          event.stopPropagation();
          writeWorkspaceTransfer(event.dataTransfer, projectId, `questions:${set.id}`, set.title);
        }}
      >{set.title}</strong><small>{questionOriginLabel(set)} · {set.questions.length} 道题 · 本次对话</small></span><ArrowUpRight size={17}/>
    </button>)}</>;
}
