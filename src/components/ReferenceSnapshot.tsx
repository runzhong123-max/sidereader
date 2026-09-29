import { BookOpen, FileQuestion, Network } from "lucide-react";
import type { ReadingAnchor } from "../types";
import type { ConceptReference } from "../tutor-sessions.mjs";
import type { QuestionReference } from "../question-references.mjs";

/** A sent reference is a snapshot: reopening it must not silently show today's edit. */
export default function ReferenceSnapshot({ concept, question, onReadAnchor, onBeforeToggle }: {
  concept?: ConceptReference;
  question?: QuestionReference;
  onReadAnchor?: (anchor: ReadingAnchor) => void;
  onBeforeToggle?: () => void;
}) {
  const title = concept?.name || question?.title || "引用";
  const anchors = concept?.anchors || question?.question.anchors || [];
  return <details className="message-reference-snapshot">
    <summary onClick={onBeforeToggle} aria-label={`查看提问时引用的${concept ? "概念" : "习题"}：${title}`}>
      {concept ? <Network size={13} aria-hidden="true" /> : <FileQuestion size={13} aria-hidden="true" />}
      <span>{title}</span>
    </summary>
    <div className="reference-snapshot-content">
      <small>提问时的内容</small>
      {concept ? <p>{concept.description || "当时未保存概念解释。"}</p> : question && <>
        <p>{question.question.prompt}</p>
        {question.question.options.length > 0 && <ol type="A">{question.question.options.map((option, index) => <li key={index}>{option}</li>)}</ol>}
      </>}
      {anchors.length > 0 && <div className="reference-snapshot-sources">{anchors.map((anchor, index) => <button key={`${anchor.sourceId}:${anchor.page}:${index}`} type="button" disabled={!onReadAnchor}
        onClick={() => onReadAnchor?.(anchor)} aria-label={`打开原文：${anchor.title}，第 ${anchor.page} 页`}>
        <BookOpen size={12} aria-hidden="true" />{anchor.title} · 第 {anchor.page} 页
      </button>)}</div>}
    </div>
  </details>;
}
