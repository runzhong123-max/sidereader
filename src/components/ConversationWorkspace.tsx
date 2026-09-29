import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRight, FileText, GitBranch } from "lucide-react";
import type { PaperNode, Project, WorkspaceTab } from "../types";
import { conversationNodes, conversationRoot } from "../conversation-model.mjs";
import { nodeTitle } from "../paper-tree-state.mjs";
import { writeWorkspaceTransfer } from "../object-transfer.mjs";
import "../conversation-workspace.css";
import "../conversation-experience.css";

type ConversationWorkspaceProps = {
  project: Project;
  targetId: string;
  onOpen: (target: WorkspaceTab) => void;
  children: ReactNode;
};

function revealPaper(button?: HTMLButtonElement) {
  const list = button?.closest<HTMLElement>(".conversation-paper-list");
  if (!button || !list) return;
  button.focus({ preventScroll: true });
  const row = button.getBoundingClientRect(), viewport = list.getBoundingClientRect();
  if (row.top < viewport.top) list.scrollTop += row.top - viewport.top;
  else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom;
}

/** Render in the owning pane's existing title bar, outside the scrolling answer. */
export function ConversationPaperNavigation({ project, targetId, onOpen }: Omit<ConversationWorkspaceProps, "children">) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState(targetId);
  const popoverId = useId();
  const navigation = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef(new Map<string, HTMLButtonElement>());
  const nodes = useMemo(() => conversationNodes(project, targetId), [project, targetId]);
  const rootId = conversationRoot(project, targetId)?.id;
  const tree = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const childrenById = new Map<string, PaperNode[]>();
    for (const node of nodes) {
      const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : "";
      childrenById.set(parentId, [...childrenById.get(parentId) || [], node]);
    }
    return { byId, childrenById };
  }, [nodes]);
  const visible: { node: PaperNode; level: number; position: number; siblings: number }[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string, level: number) => {
    const siblings = tree.childrenById.get(parentId) || [];
    siblings.forEach((node, index) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      visible.push({ node, level, position: index + 1, siblings: siblings.length });
      if (!collapsed.has(node.id)) visit(node.id, level + 1);
    });
  };
  visit("", 1);

  useEffect(() => {
    setOpen(false);
    setCollapsed(new Set());
  }, [project.id, rootId]);

  useEffect(() => {
    if (!open) return;
    setFocusedId(targetId);
    const frame = requestAnimationFrame(() => revealPaper(items.current.get(targetId)));
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigation.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open, targetId]);

  const focus = (id: string) => { setFocusedId(id); revealPaper(items.current.get(id)); };
  const toggle = (id: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const activate = (node: PaperNode) => { onOpen(node); setOpen(false); trigger.current?.focus(); };
  const onTreeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, node: PaperNode) => {
    if (event.nativeEvent.isComposing) return;
    const index = visible.findIndex((entry) => entry.node.id === node.id);
    const child = tree.childrenById.get(node.id)?.[0];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focus(visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))].node.id);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); focus(visible[event.key === "Home" ? 0 : visible.length - 1].node.id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (child && !collapsed.has(node.id)) toggle(node.id);
      else if (node.parentId && tree.byId.has(node.parentId)) focus(node.parentId);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (child && collapsed.has(node.id)) toggle(node.id);
      else if (child) focus(child.id);
    }
  };
  const reveal = () => {
    // Reopening always reveals the current paper, even after its ancestors were folded.
    setCollapsed((previous) => {
      const next = new Set(previous), seen = new Set<string>();
      let node = tree.byId.get(targetId);
      while (node?.parentId && !seen.has(node.id)) {
        seen.add(node.id); next.delete(node.parentId); node = tree.byId.get(node.parentId);
      }
      return next;
    });
    setOpen((value) => !value);
  };

  return nodes.length > 1 ? <div className="conversation-paper-navigation" ref={navigation} onBlur={(event) => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    }}>
      <button ref={trigger} type="button" className="conversation-paper-trigger" aria-label={`本对话的分支，${nodes.length - 1} 个，可返回主对话`} title="查看内部纸张与分支，或返回主对话" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoverId : undefined} onClick={reveal} onKeyDown={(event) => {
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) { event.preventDefault(); reveal(); }
      }}>
        <GitBranch size={14} aria-hidden="true" /><span>分支 · {nodes.length - 1}</span>
      </button>
      {open && <div id={popoverId} className="conversation-paper-popover" role="dialog" aria-label="本对话的纸张">
        <div className="conversation-paper-list" role="tree" aria-label="对话纸张树">
          {visible.map(({ node, level, position, siblings }) => {
            const hasChildren = !!tree.childrenById.get(node.id)?.length;
            return <button key={node.id} ref={(element) => { if (element) items.current.set(node.id, element); else items.current.delete(node.id); }} type="button" role="treeitem" className="conversation-paper-entry" aria-label={`${node.id === rootId ? "主对话" : "分支"}：${nodeTitle(project, node)}${node.id === targetId ? "，当前纸张" : ""}`} aria-level={level} aria-posinset={position} aria-setsize={siblings} aria-selected={node.id === targetId} aria-expanded={hasChildren ? !collapsed.has(node.id) : undefined} tabIndex={focusedId === node.id ? 0 : -1} style={{ paddingInlineStart: 8 + (level - 1) * 15 }} title={`${node.id === rootId ? "返回主对话：" : "打开分支："}${nodeTitle(project, node)}`} draggable onDragStart={(event) => writeWorkspaceTransfer(event.dataTransfer, project.id, node.id, nodeTitle(project, node), "paper")} onDragEnd={() => setOpen(false)} onFocus={() => setFocusedId(node.id)} onKeyDown={(event) => onTreeKeyDown(event, node)} onClick={() => activate(node)}>
              <span className="conversation-paper-disclosure" onClick={hasChildren ? (event) => { event.stopPropagation(); toggle(node.id); } : undefined}>{hasChildren && <ChevronRight size={12} className={collapsed.has(node.id) ? "" : "is-expanded"} aria-hidden="true" />}</span>
              <FileText size={14} aria-hidden="true" /><span className="conversation-paper-name">{nodeTitle(project, node)}</span>
              <small>{node.id === rootId ? "主对话" : node.id === targetId ? "当前" : ""}</small>
            </button>;
          })}
        </div>
      </div>}
    </div> : null;
}

/** Presentation only; branch navigation is supplied by the surrounding pane. */
export default function ConversationWorkspace({ children }: ConversationWorkspaceProps) {
  return <div className="conversation-workspace conversation-experience">
    <div className="conversation-current-paper">{children}</div>
  </div>;
}
