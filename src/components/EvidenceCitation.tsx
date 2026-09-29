import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, X } from "lucide-react";
import type { Evidence } from "../types";
import { citationPreviewPosition } from "../citation-preview.mjs";
import SourceEvidenceExcerpt from "./SourceEvidenceExcerpt";
import "../citation-preview.css";

/** Citation clicks inspect evidence; only the explicit action navigates the reader. */
export default function EvidenceCitation({ evidence, onOpen, children, className, label }: {
  evidence: Evidence;
  onOpen: (evidence: Evidence) => void;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof citationPreviewPosition>>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const origin = `${evidence.title} · 第 ${evidence.page} 页`;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const updatePosition = () => {
      if (!trigger.current || !panel.current) return;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      panel.current.style.width = `${Math.min(380, Math.max(0, width - 24))}px`;
      panel.current.style.maxHeight = `${Math.max(0, height - 24)}px`;
      setPosition(citationPreviewPosition(trigger.current.getBoundingClientRect(),
        { left, top, width, height }, panel.current.getBoundingClientRect()));
    };
    updatePosition();
    const resize = new ResizeObserver(updatePosition);
    resize.observe(panel.current);
    return () => resize.disconnect();
  }, [open]);

  useLayoutEffect(() => {
    if (open && position) panel.current?.focus({ preventScroll: true });
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    function scroll(event: Event) {
      // Scrolling the excerpt is allowed. Scrolling its anchor dismisses it.
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      close(Boolean(panel.current?.contains(document.activeElement)));
    }
    function resize() { close(Boolean(panel.current?.contains(document.activeElement))); }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", scroll, { capture: true, passive: true });
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className={className}
      aria-label={label || `预览来源：${origin}`} title={`预览原文 · ${origin}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { setPosition(undefined); setOpen((value) => !value); }}>
      {children}
    </button>
    {open && createPortal(
      <div ref={panel} id={panelId} role="dialog" aria-labelledby={titleId} tabIndex={-1}
        className="citation-preview" style={{ ...position, visibility: position ? "visible" : "hidden" }}>
        <header className="citation-preview-header">
          <div><small>原文摘录</small><strong id={titleId}>{origin}</strong>
            {evidence.path && <span>{evidence.path}</span>}
          </div>
          <button type="button" className="citation-preview-close" aria-label="关闭原文预览" onClick={() => close(true)}><X size={15} aria-hidden="true" /></button>
        </header>
        <div className="citation-preview-text" tabIndex={0} aria-label="原文摘录，可滚动">
          <SourceEvidenceExcerpt text={evidence.text} sourceId={evidence.sourceId} page={evidence.page} compact={false} />
        </div>
        <footer><button type="button" onClick={() => { close(); onOpen(evidence); }}>
          <BookOpen size={14} aria-hidden="true" />打开原文
        </button></footer>
      </div>, document.body)}
  </>;
}
