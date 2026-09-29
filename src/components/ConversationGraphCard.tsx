import type { DragEvent } from "react";
import { GripVertical, Network } from "lucide-react";
import type { ConversationGraph, ReadingAnchor } from "../types";
import { writeWorkspaceTransfer } from "../object-transfer.mjs";
import Graph from "./Graph";
import ObjectContext from "./ObjectContext";
import "../conversation-graph-card.css";
import "../conversation-experience.css";

/** A conversation owns the object; every placement shares the same graph interactions. */
export default function ConversationGraphCard({ graph, projectId, workspaceNodeId, onOpen, onReferenceConcept, onReadAnchor }: {
  graph: ConversationGraph;
  projectId?: string;
  workspaceNodeId?: string;
  onOpen?: (graph: ConversationGraph) => void;
  onReferenceConcept?: (id: string) => void;
  onReadAnchor?: (anchor: ReadingAnchor) => void;
}) {
  const dragCard = (event: DragEvent) => {
    if (!projectId || !workspaceNodeId) return;
    event.stopPropagation();
    writeWorkspaceTransfer(event.dataTransfer, projectId, workspaceNodeId, graph.title, "object");
  };
  return <section className="learning-object conversation-graph-card" aria-label={`对话知识图谱：${graph.title}`}>
    <header>
      <Network size={14} aria-hidden="true" />
      <button className="learning-object-title" type="button" disabled={!onOpen}
        aria-label={`展开图谱卡片：${graph.title}`} onClick={() => onOpen?.(graph)}
        draggable={Boolean(projectId && workspaceNodeId)} onDragStart={dragCard}>
        <span>{graph.title}</span><GripVertical className="object-drag-handle" size={14} aria-hidden="true" />
      </button>
    </header>
    <ObjectContext label="本次对话图谱" />
    <div className="conversation-graph-view" style={{ height: graph.concepts.length <= 6 ? 300 : 360 }}>
      <Graph concepts={graph.concepts} relationKind="related" inline projectId={projectId}
        onReferenceConcept={onReferenceConcept} onReadAnchor={onReadAnchor}
        viewKey={`${projectId || "conversation"}:inline:${graph.id}`} />
    </div>
  </section>;
}
