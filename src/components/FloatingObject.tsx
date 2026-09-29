import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, MoveDiagonal2, X } from "lucide-react";
import ContentViewMenu from "./ContentViewMenu";
import { cardDockPosition, shouldPassFloatingTransfer } from "../object-transfer.mjs";
import { splitBounds } from "../study-layout.mjs";
import "../floating-object.css";

type Box = { x: number; y: number; width: number; height: number };
type Bounds = { width: number; height: number };
type Gesture = { kind: "move" | "resize"; pointer: number; clientX: number; clientY: number; initial: Box; target: HTMLElement; moved: boolean };
const savedBoxes = new Map<string, Box>();

function boundaryPadding(bounds: Bounds) {
  return bounds.width < 340 || bounds.height < 260 ? 0 : 8;
}
function clampBox(box: Box, bounds: Bounds): Box {
  const padding = boundaryPadding(bounds);
  const availableWidth = Math.max(1, bounds.width - padding * 2);
  const availableHeight = Math.max(1, bounds.height - padding * 2);
  const width = Math.min(availableWidth, Math.max(Math.min(320, availableWidth), box.width));
  const height = Math.min(availableHeight, Math.max(Math.min(240, availableHeight), box.height));
  return { width, height, x: Math.max(padding, Math.min(box.x, bounds.width - width - padding)), y: Math.max(padding, Math.min(box.y, bounds.height - height - padding)) };
}

export default function FloatingObject({ id, title, typeLabel, index, projectId, nodeId, children, toolbarContent, onClose, onDock, onFocus }: {
  id: string;
  title: string;
  typeLabel?: string;
  index: number;
  projectId: string;
  nodeId: string;
  children: ReactNode;
  toolbarContent?: ReactNode;
  onClose: () => void;
  onDock: (side: "main" | "left" | "right") => void;
  onFocus: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const initialIndex = useRef(index);
  const bounds = useRef<Bounds>({ width: 1000, height: 700 });
  const [box, setBox] = useState<Box>(() => savedBoxes.get(id) || { x: 40 + index * 28, y: 36 + index * 24, width: 620, height: 520 });
  const boxRef = useRef(box);
  const gesture = useRef<Gesture | null>(null);
  const [moving, setMoving] = useState(false);
  const [dockSide, setDockSide] = useState<"main" | "left" | "right" | null>(null);
  const [dockArea, setDockArea] = useState<Box | null>(null);
  const [dockContainer, setDockContainer] = useState<HTMLElement | null>(null);
  const [workspaceDragging, setWorkspaceDragging] = useState(false);
  const headingId = useId();

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !root.current?.contains(active)) returnFocus.current = active;
  }, []);

  useEffect(() => {
    // Floating cards do not shield the workspace underneath during a transfer.
    // dragover exposes MIME types even when the browser protects the payload.
    const preview = (event: DragEvent) => {
      const hasReceiver = Boolean(root.current?.querySelector("[data-concept-drop]"));
      setWorkspaceDragging(shouldPassFloatingTransfer(event.dataTransfer?.types || [], hasReceiver));
    };
    const clear = () => setWorkspaceDragging(false);
    window.addEventListener("dragover", preview, true);
    window.addEventListener("drop", clear, true);
    window.addEventListener("dragend", clear, true);
    const cancel = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") clear(); };
    window.addEventListener("keydown", cancel, true);
    return () => {
      window.removeEventListener("dragover", preview, true);
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, []);

  function updateBox(next: Box) {
    const clamped = clampBox(next, bounds.current);
    boxRef.current = clamped;
    setBox(clamped);
    savedBoxes.set(id, clamped);
  }
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    setDockContainer(parent);
    let first = true;
    const resize = () => {
      const rect = parent.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      bounds.current = { width: rect.width, height: rect.height };
      const saved = savedBoxes.get(id);
      const initial = first && !saved ? {
        x: 32 + (initialIndex.current % 6) * 28,
        y: 24 + (initialIndex.current % 6) * 24,
        width: Math.min(620, rect.width * 0.7),
        height: Math.min(520, rect.height * 0.8),
      } : boxRef.current;
      updateBox(initial);
      first = false;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [id]);
  useEffect(() => () => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.target.hasPointerCapture(current.pointer)) current.target.releasePointerCapture(current.pointer);
  }, []);

  function begin(event: PointerEvent<HTMLElement>, kind: Gesture["kind"]) {
    if (event.button !== 0 || gesture.current) return;
    if (kind === "move" && (event.target as Element).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    gesture.current = { kind, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, initial: boxRef.current, target: event.currentTarget, moved: false };
    const rect = workspaceBounds(), parentRect = root.current?.parentElement?.getBoundingClientRect();
    setDockArea(kind === "move" && rect && parentRect ? { x: rect.left - parentRect.left, y: rect.top - parentRect.top, width: rect.width, height: rect.height } : null);
    event.currentTarget.setPointerCapture(event.pointerId);
    setMoving(kind === "move");
  }
  function workspaceBounds() {
    const workspace = root.current?.closest(".main-shell")?.querySelector<HTMLElement>(".study-workspace");
    return (workspace || root.current?.parentElement)?.getBoundingClientRect();
  }
  function dockAt(clientX: number, clientY: number) {
    const rect = workspaceBounds();
    return rect ? cardDockPosition(clientX - rect.left, clientY - rect.top, rect.width, rect.height) : null;
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.clientX;
    const dy = event.clientY - current.clientY;
    if (Math.hypot(dx, dy) > 3) current.moved = true;
    if (!current.moved) return;
    if (current.kind === "move") {
      updateBox({ ...current.initial, x: current.initial.x + dx, y: current.initial.y + dy });
      setDockSide(dockAt(event.clientX, event.clientY));
    } else {
      const padding = boundaryPadding(bounds.current);
      updateBox({ ...current.initial, width: Math.min(current.initial.width + dx, bounds.current.width - current.initial.x - padding), height: Math.min(current.initial.height + dy, bounds.current.height - current.initial.y - padding) });
    }
  }
  function finish(event?: PointerEvent<HTMLElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || (event && current.pointer !== event.pointerId)) return;
    gesture.current = null;
    if (current.target.hasPointerCapture(current.pointer)) current.target.releasePointerCapture(current.pointer);
    setMoving(false);
    setDockSide(null);
    if (cancelled) updateBox(current.initial);
    else if (current.kind === "move" && current.moved && event) {
      const side = dockAt(event.clientX, event.clientY);
      if (side) onDock(side);
    }
  }
  function keyboard(event: KeyboardEvent<HTMLElement>, kind: Gesture["kind"]) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Escape" && gesture.current) {
      event.preventDefault();
      event.stopPropagation();
      finish(undefined, true);
      return;
    }
    if (event.key === "Escape" && kind === "move") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    const amount = event.shiftKey ? 30 : 10;
    const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    const current = boxRef.current;
    const padding = boundaryPadding(bounds.current);
    updateBox(kind === "move" ? { ...current, x: current.x + dx, y: current.y + dy } : {
      ...current, width: Math.min(current.width + dx, bounds.current.width - current.x - padding), height: Math.min(current.height + dy, bounds.current.height - current.y - padding),
    });
  }
  function visibleFocusTarget(element: HTMLElement | null): element is HTMLElement {
    if (!element?.isConnected || element === document.body || element.closest("[hidden], [inert]") || element.matches(":disabled")) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    // Mobile navigation closes by moving offscreen, without a hidden attribute.
    return style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 &&
      rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
  }
  function close() {
    onClose();
    requestAnimationFrame(() => {
      if (visibleFocusTarget(returnFocus.current)) {
        returnFocus.current.focus({ preventScroll: true });
        return;
      }
      const visible = Array.from(document.querySelectorAll<HTMLElement>(".reader-main:not([hidden]) [data-reader-focus], .reader-main:not([hidden]), .study-companion"))
        .find(visibleFocusTarget);
      visible?.focus({preventScroll:true});
    });
  }
  const pointerHandlers = { onPointerMove: move, onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event), onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true), onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true) };

  const dockTargets = moving && dockArea && dockContainer ? createPortal(
    <div className="floating-dock-zones" aria-hidden="true" style={{ left: dockArea.x, top: dockArea.y, width: dockArea.width, height: dockArea.height }}>
      <div className={`floating-dock-target is-main${dockSide === "main" ? " is-active" : ""}`}><span>{dockSide === "main" ? "松开，设为主视觉" : "设为主视觉"}</span></div>
      {splitBounds(dockArea.width, true).canSplit && <>
        <div className={`floating-dock-target is-left${dockSide === "left" ? " is-active" : ""}`}><span>左侧并排</span></div>
        <div className={`floating-dock-target is-right${dockSide === "right" ? " is-active" : ""}`}><span>右侧并排</span></div>
      </>}
    </div>, dockContainer,
  ) : null;

  return <><section ref={root} tabIndex={-1} className={`floating-object${moving ? " is-moving" : ""}${workspaceDragging ? " has-workspace-drag" : ""}`} data-workspace-node-id={nodeId} data-project-id={projectId} data-object-node-id={nodeId} aria-labelledby={headingId}
    style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height, zIndex: index + 1 }} onPointerDownCapture={onFocus} onFocusCapture={onFocus}>
    <header className="floating-object-header" tabIndex={0} aria-label={`移动${title}，方向键调整位置`} title="拖动标题栏移动；拖到顶部中央或两侧提示区停靠" onPointerDown={(event) => begin(event, "move")} onKeyDown={(event) => keyboard(event, "move")} {...pointerHandlers}>
      {/* The grip belongs to the same pointer gesture as the title. Native
          draggable here would steal the gesture instead of moving the card. */}
      <span className="floating-move-grip" aria-hidden="true"><GripHorizontal size={15} /></span>
      <small className="content-type-label">{typeLabel}</small>
      <strong id={headingId}>{title}</strong>
      <div className="floating-object-actions">
        {toolbarContent}
        <ContentViewMenu title={title} current="float" canSplit={splitBounds(bounds.current.width, true).canSplit} onPlace={(position) => { if (position !== "float") onDock(position); }} />
        <button aria-label={`关闭${title}浮窗`} title="关闭浮窗" onClick={close}><X size={16} /></button>
      </div>
    </header>
    <div className="floating-object-content">{children}</div>
    {dockSide && <div className="floating-object-dock-hint" role="status">{dockSide === "main" ? "松开，设为主视觉" : `松开，${dockSide === "left" ? "左" : "右"}侧并排`}</div>}
    <div className="floating-object-resize" role="button" tabIndex={0} aria-label={`调整${title}浮窗大小，使用方向键`} title="拖动调整大小；也可用方向键" onPointerDown={(event) => begin(event, "resize")} onKeyDown={(event) => keyboard(event, "resize")} {...pointerHandlers}><MoveDiagonal2 size={14} aria-hidden="true" /></div>
  </section>{dockTargets}</>;
}
