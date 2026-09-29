import { GripVertical, Maximize2 } from "lucide-react";
import type { DragEvent } from "react";
import type { Evidence, LearningObject } from "../types";
import { objectMarkdown } from "../learning-objects.mjs";
import { writeWorkspaceTransfer } from "../object-transfer.mjs";
import AnswerMarkdown, { CopyButton } from "./AnswerMarkdown";
import "../answer-fragment.css";

/** Ordinary explanation stays in the reading flow; its saved identity remains available on demand. */
export default function AnswerFragment({ object, projectId, workspaceNodeId, evidence, onCitation, onOpen }: {
  object: LearningObject;
  projectId?: string;
  workspaceNodeId?: string;
  evidence: Evidence[];
  onCitation: (evidence: Evidence) => void;
  onOpen?: (object: LearningObject) => void;
}) {
  const drag = (event: DragEvent) => {
    if (!projectId) return;
    event.stopPropagation();
    writeWorkspaceTransfer(event.dataTransfer, projectId, workspaceNodeId || object.id, object.title, "object");
  };
  return <div className={`answer-fragment answer-fragment-${object.kind}`} data-object-id={object.id}>
    <AnswerMarkdown content={objectMarkdown(object)} evidence={evidence} onCitation={onCitation} showCopy={false}/>
    <div className="answer-fragment-actions" role="group" aria-label={`${object.title}的操作`}>
      <CopyButton value={object.content} label="复制"/>
      {onOpen && <button type="button" onClick={() => onOpen(object)} aria-label={`展开：${object.title}`}><Maximize2 size={13}/>展开</button>}
      {projectId && <button type="button" draggable onDragStart={drag} className="answer-fragment-drag" aria-label={`拖动${object.title}到阅读区对照`} title="拖到主区或两侧对照"><GripVertical size={14}/></button>}
    </div>
  </div>;
}
