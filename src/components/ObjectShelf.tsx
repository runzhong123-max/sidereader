import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, FileQuestion, Layers, Network, Route, X } from "lucide-react";
import type { PaperNode, Project, WorkspaceTab } from "../types";
import { conversationOwner } from "../conversation-model.mjs";
import { learningObjectNodes } from "../paper-navigation.mjs";
import { nodeTitle } from "../paper-tree-state.mjs";
import { surfaceDefinition, type SurfaceDefinition } from "../domain/objects.mjs";
import { writeWorkspaceTransfer } from "../object-transfer.mjs";
import "../object-shelf.css";

type Scope = "current" | "project" | "all";
const surfaceIcons: Record<SurfaceDefinition["icon"], typeof Network> = {
  network: Network, route: Route, practice: BookOpen, object: FileQuestion,
};

export default function ObjectShelf({ project, activeId, onFloat, onOpenScopeGraph }: {
  project: Project;
  activeId: string;
  onFloat: (node: WorkspaceTab) => void;
  onOpenScopeGraph: (ownerId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("current");
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 18, bottom: 100, width: 350, maxHeight: 500 });
  const panelId = useId();
  const owner = conversationOwner(project, activeId);
  const currentId = owner?.role === "chapter" ? owner.id : project.paperTree?.tutorId;
  const currentTitle = owner?.role === "chapter" ? nodeTitle(project, owner) : "项目";
  const objects = useMemo(() => learningObjectNodes(project).map((node) => ({
    node, owner: conversationOwner(project, node.id),
  })), [project]);
  const shown = objects.filter((item) => scope === "all" || item.owner?.id === (scope === "project" ? project.paperTree?.tutorId : currentId));
  const missingCurrentGraph = scope === "current" && owner?.role === "chapter" && !shown.some(({ node }) => node.kind === "graph");

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(350, window.innerWidth - 36);
      setPosition({ left: Math.max(18, Math.min(rect.left, window.innerWidth - width - 18)), bottom: window.innerHeight - rect.top + 8, width, maxHeight: Math.max(96, Math.min(620, rect.top - 24)) });
    };
    place();
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const title = (node: PaperNode) => {
    const definition = surfaceDefinition(node.kind);
    return node.id === node.kind && definition ? definition.projectTitle : nodeTitle(project, node);
  };
  const run = (action: () => void) => { action(); setOpen(false); };

  return <div className="object-shelf" ref={rootRef} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !panelRef.current?.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
  }}>
    <button ref={triggerRef} className="object-shelf-trigger" aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      <Layers size={17}/><span>学习对象</span>
    </button>
    {open && createPortal(<section ref={panelRef} id={panelId} style={position} className="object-shelf-panel" role="dialog" aria-modal="false" aria-label="学习对象">
      <header><strong>学习对象</strong><button className="icon-button" aria-label="收起学习对象" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={16}/></button></header>
      <div className="object-shelf-scopes" role="group" aria-label="学习对象范围">
        {([{ id: "current", label: "当前范围" }, { id: "project", label: "项目" }, { id: "all", label: "全部" }] as const).map((item) =>
          <button key={item.id} aria-pressed={scope === item.id} onClick={() => setScope(item.id)}>{item.label}</button>)}
      </div>
      <p className="object-shelf-context">{scope === "current" ? currentTitle : scope === "project" ? "项目范围" : "所有章节与项目"}</p>
      <ul className="object-shelf-cards">
        {missingCurrentGraph && <li><button className="object-shelf-card" aria-label={`打开${currentTitle}的知识图谱卡片`} onClick={() => run(() => onOpenScopeGraph(owner.id))}>
          <span className="object-shelf-card-type"><Network size={17}/>{surfaceDefinition("graph").title}</span>
          <strong>{currentTitle}</strong><small>自动整理</small>
        </button></li>}
        {shown.map(({ node, owner: objectOwner }) => {
          const label = title(node);
          const definition = surfaceDefinition(node.kind);
          if (!definition) return null;
          const Icon = surfaceIcons[definition.icon];
          const set = node.objectId ? project.sets.find((item) => item.id === node.objectId) : undefined;
          const location = objectOwner?.role === "chapter" ? nodeTitle(project, objectOwner) : "项目";
          const count = node.kind === "graph" ? `${node.conceptIds?.length ?? project.concepts.length} 个概念`
            : node.kind === "path" ? `${node.stageIds?.length ?? project.stages.length} 个关卡`
            : set ? `${set.questions.length} 道题` : "";
          return <li key={node.id}>
            <button className="object-shelf-card" draggable onDragStart={(event) => {
              writeWorkspaceTransfer(event.dataTransfer, project.id, node.id, label, "object");
            }} onDragEnd={() => setOpen(false)} onClick={() => run(() => onFloat(node))} aria-label={`打开卡片：${label}`} title="点击或拖出卡片">
              <span className="object-shelf-card-type"><Icon size={17}/>{definition.title}</span>
              <strong>{label}</strong><small>{[scope === "all" ? location : "", count].filter(Boolean).join(" · ") || location}</small>
            </button>
          </li>;
        })}
      </ul>
      {!shown.length && !missingCurrentGraph && <p className="object-shelf-empty">这个范围还没有学习对象。</p>}
    </section>, document.body)}
  </div>;
}
