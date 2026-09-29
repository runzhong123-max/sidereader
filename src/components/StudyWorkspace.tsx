import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical, Maximize2, Minimize2, X } from "lucide-react";
import ContentViewMenu from "./ContentViewMenu";
import { companionWidth, splitBounds } from "../study-layout.mjs";
import { OBJECT_MIME, readWorkspacePayload, workspaceTransferKind, shouldPassWorkspaceTransfer, writeWorkspaceTransfer, objectDropPosition, type WorkspaceDropPosition } from "../object-transfer.mjs";
import { WORKSPACE_POINTER_EVENT, workspacePointerPosition, type WorkspacePointerUpdate } from "../workspace-pointer-transfer.mjs";

import { persistenceKeys } from "../persistence/keys.mjs";
import { localPreferences } from "../persistence/preferences.mjs";

export default function StudyWorkspace({ children, companion, open, expanded, onOpenChange, onExpandedChange, selection, companionTitle, companionTypeLabel, companionKind, companionDraggable = true, primaryKind, primaryId, onContentFocus, side = "right", projectId, onDropObject, onPresentationChange, primaryToolbar, navigationControl, companionToolbarContent }: {
  children: ReactNode;
  companion: ReactNode;
  companionToolbarContent?: ReactNode;
  open: boolean;
  expanded: boolean;
  onOpenChange: (open: boolean) => void;
  onExpandedChange: (expanded: boolean) => void;
  selection: string;
  companionTitle: string;
  companionTypeLabel?: string;
  companionKind?: string;
  companionDraggable?: boolean;
  primaryKind?: string;
  primaryId?: string;
  onContentFocus?: (nodeId: string) => void;
  side?: "left" | "right";
  projectId: string;
  onDropObject?: (id: string, position: WorkspaceDropPosition) => void;
  onPresentationChange?: (companionOnly: boolean) => void;
  primaryToolbar?: ReactNode;
  navigationControl?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const separator = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(() => {
    const saved = localPreferences.getJSON<number>(persistenceKeys.splitRatio, .38,
      (value) => typeof value === "number" && value >= .2 && value <= .8);
    return saved;
  });
  const [dragging, setDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<WorkspaceDropPosition>();
  const pointerDrop = useRef(onDropObject);
  pointerDrop.current = onDropObject;
  useEffect(() => {
    const receive = (event: Event) => {
      const update = (event as CustomEvent<WorkspacePointerUpdate>).detail;
      if (update?.projectId !== projectId) return;
      const position = workspacePointerPosition(update, projectId, root.current?.getBoundingClientRect());
      setDropPosition(update.phase === "move" ? position : undefined);
      if (update.phase === "drop" && position) pointerDrop.current?.(update.nodeId, position);
    };
    window.addEventListener(WORKSPACE_POINTER_EVENT, receive);
    return () => window.removeEventListener(WORKSPACE_POINTER_EVENT, receive);
  }, [projectId]);
  useEffect(()=>{
    const clear = ()=>setDropPosition(undefined);
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    window.addEventListener("dragend",clear); window.addEventListener("drop",clear); window.addEventListener("keydown", cancel);
    return ()=>{window.removeEventListener("dragend",clear);window.removeEventListener("drop",clear);window.removeEventListener("keydown", cancel);};
  },[]);
  const drag = useRef<{ x: number; width: number; ratio: number; pointer: number } | null>(null);
  const reference = companionKind !== "chat";
  const returnLabel = primaryKind === "book" ? "返回原文" : "返回主内容";
  const bounds = splitBounds(width, reference);
  const canDropSplit = splitBounds(width, true).canSplit;
  const narrow = width > 0 && !bounds.canSplit;
  const companionOnly = open && (expanded || narrow);
  const pixels = companionWidth(width, ratio, reference);
  const presentationCallback = useRef(onPresentationChange);
  presentationCallback.current = onPresentationChange;
  useLayoutEffect(() => {
    presentationCallback.current?.(companionOnly);
  }, [companionOnly]);
  useLayoutEffect(() => () => presentationCallback.current?.(false), []);
  useLayoutEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  function persist(next: number) {
    localPreferences.setJSON(persistenceKeys.splitRatio, next);
  }
  function resize(next: number, save = false) {
    const clamped = Math.max(bounds.min, Math.min(bounds.max, next));
    const value = bounds.available > 0 ? clamped / bounds.available : .38;
    setRatio(value);
    if (save) persist(value);
    return value;
  }
  function close() {
    onOpenChange(false);
    onExpandedChange(false);
    requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>(".reader-main [data-reader-focus]") || root.current?.querySelector<HTMLElement>(".reader-main"))?.focus({ preventScroll: true }));
  }
  function cancelResize() {
    const current = drag.current;
    drag.current = null;
    if (current) setRatio(current.ratio);
    setDragging(false);
    if (current && separator.current?.hasPointerCapture(current.pointer)) separator.current.releasePointerCapture(current.pointer);
  }
  function placeCompanion(position: WorkspaceDropPosition) {
    if (onDropObject && companionDraggable) onDropObject(selection, position);
  }
  const toolbar = <header className={`companion-toolbar surface-heading${companionOnly ? " is-global" : ""}`}>
    {companionOnly && navigationControl}
    <span className="companion-title" draggable={companionDraggable} title={companionDraggable ? `拖动${companionTitle}，放到中央或两侧重新安排` : companionTitle}
      onDragStart={(event) => writeWorkspaceTransfer(event.dataTransfer, projectId, selection, companionTitle, companionKind === "book" || companionKind === "chat" ? "paper" : "card")}>
      {companionDraggable && <GripVertical size={13} aria-hidden="true" />}<small className="content-type-label">{companionTypeLabel}</small><strong>{companionTitle}</strong>
    </span>
    {companionToolbarContent}
    {onDropObject && companionDraggable ? <ContentViewMenu title={companionTitle} current={side} onPlace={placeCompanion} canSplit={!narrow} />
      : !narrow && <button className="icon-button" aria-label={expanded ? "恢复并排" : "放大对话"} title={expanded ? "恢复并排" : "放大对话"} onClick={() => onExpandedChange(!expanded)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>}
    <button className={`companion-close ${narrow || expanded ? "companion-return" : "icon-button"}`} onClick={close} aria-label={`关闭对照区，${returnLabel}`} title={`关闭对照区，${returnLabel}`}>{narrow || expanded ? returnLabel : <X size={18} />}</button>
  </header>;
  return (
    <div ref={root} className={`book-workspace study-workspace companion-on-${side} ${open ? "has-companion" : "reading-only"} ${expanded ? "companion-expanded" : ""} ${narrow ? "single-pane" : ""} ${dragging ? "is-resizing" : ""}`}
      onDragOverCapture={(event) => {
        const acceptsReferences = event.target instanceof Element && Boolean(event.target.closest("[data-concept-drop]"));
        if (!shouldPassWorkspaceTransfer(event.dataTransfer.types, acceptsReferences)) setDropPosition(undefined);
      }}
      onDragOver={(event)=>{
        const kind = workspaceTransferKind(event.dataTransfer.types);
        if (!kind) return;
        const acceptsReferences = event.target instanceof Element && Boolean(event.target.closest("[data-concept-drop]"));
        if (!shouldPassWorkspaceTransfer(event.dataTransfer.types, acceptsReferences)) return;
        event.preventDefault(); event.dataTransfer.dropEffect = "copy";
        const bounds = event.currentTarget.getBoundingClientRect();
        setDropPosition(objectDropPosition(event.clientX - bounds.left, bounds.width, kind, canDropSplit, event.clientY - bounds.top, bounds.height));
      }}
      onDragLeave={(event)=>{if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPosition(undefined);}}
      onDragEnd={()=>setDropPosition(undefined)}
      onDrop={(event)=>{
        setDropPosition(undefined);
        if (!workspaceTransferKind(event.dataTransfer.types)) return;
        const acceptsReferences = event.target instanceof Element && Boolean(event.target.closest("[data-concept-drop]"));
        if (!shouldPassWorkspaceTransfer(event.dataTransfer.types, acceptsReferences)) return;
        event.preventDefault(); event.stopPropagation();
        const payload = readWorkspacePayload(event.dataTransfer.getData(OBJECT_MIME), projectId);
        const bounds = event.currentTarget.getBoundingClientRect();
        if (payload) onDropObject?.(payload.id, objectDropPosition(event.clientX - bounds.left, bounds.width, payload.kind, canDropSplit, event.clientY - bounds.top, bounds.height));
      }}>
      <div className="reader-main" data-workspace-node-id={primaryId} tabIndex={-1} hidden={companionOnly}
        onFocusCapture={()=>primaryId && onContentFocus?.(primaryId)}>{primaryToolbar}<div className="primary-content">{children}</div></div>
      {open && !expanded && !narrow && (
        <div
          className="study-splitter"
          ref={separator}
          role="separator"
          tabIndex={0}
          aria-label="调整主内容与对照区宽度"
          aria-orientation="vertical"
          aria-controls="study-companion"
          aria-valuemin={Math.round(bounds.min)}
          aria-valuemax={Math.round(bounds.max)}
          aria-valuenow={pixels}
          aria-valuetext={`对照区 ${pixels} 像素`}
          title="拖动调整宽度；方向键微调，Esc 取消，双击恢复，Enter 收起"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, width: pixels, ratio, pointer: event.pointerId };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (drag.current) resize(drag.current.width + (drag.current.x - event.clientX) * (side === "right" ? 1 : -1));
          }}
          onPointerUp={(event) => {
            if (!drag.current) return;
            resize(drag.current.width + (drag.current.x - event.clientX) * (side === "right" ? 1 : -1), true);
            drag.current = null;
            setDragging(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={cancelResize}
          onLostPointerCapture={cancelResize}
          onDoubleClick={() => { setRatio(reference ? .5 : .38); persist(reference ? .5 : .38); }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 64 : 24;
            if (event.key === "Escape" && drag.current) cancelResize();
            else if (event.key === "ArrowLeft") resize(pixels + step * (side === "right" ? 1 : -1), true);
            else if (event.key === "ArrowRight") resize(pixels - step * (side === "right" ? 1 : -1), true);
            else if (event.key === "Home") resize(bounds.min, true);
            else if (event.key === "End") resize(bounds.max, true);
            else if (event.key === "Enter") close();
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        ><span /></div>
      )}
      {open && (
        <section className="study-companion" id="study-companion" data-workspace-node-id={selection} tabIndex={-1} onFocusCapture={()=>onContentFocus?.(selection)} aria-label="对照区" style={{ width: expanded || narrow ? "100%" : pixels }}>
          {toolbar}
          <div className={`companion-content companion-${companionKind === "chat" ? "tutor" : "object"}`}>{companion}</div>
        </section>
      )}
      {dropPosition && <div className={`workspace-drop-zones${canDropSplit ? "" : " is-narrow"}`} aria-hidden="true">
        {([...(canDropSplit ? ["left", "right"] : []), "main", "float"] as WorkspaceDropPosition[]).map((position) => (
          <div key={position} className={`workspace-drop-zone is-${position}${dropPosition === position ? " is-active" : ""}`}>
            <span>{dropPosition === position ? "松开，" : ""}{position === "main" ? "设为主视觉" : position === "float" ? "浮窗查看" : `${position === "left" ? "左" : "右"}侧并排`}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}
