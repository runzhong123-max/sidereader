import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import "../action-menu.css";

type ActionMenuProps = {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  placement?: "top" | "bottom";
};

export default function ActionMenu({
  label,
  trigger,
  children,
  className = "",
  align = "end",
  placement = "bottom",
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusReturnFrame = useRef<number | null>(null);
  const panelId = useId();

  function cancelFocusReturn() {
    if (focusReturnFrame.current !== null) cancelAnimationFrame(focusReturnFrame.current);
    focusReturnFrame.current = null;
  }

  useEffect(() => cancelFocusReturn, []);

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: Event) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function dismissWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("click", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("click", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape, true);
    };
  }, [open]);

  function dismissAfterAction(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest("button, a");
    if (!action || !event.currentTarget.contains(action)) return;
    const keepOpen = action.closest("[data-menu-keep-open]");
    if (keepOpen && event.currentTarget.contains(keepOpen)) return;
    const focusedItem = document.activeElement;
    const returnFocus = focusedItem instanceof HTMLElement && event.currentTarget.contains(focusedItem);
    setOpen(false);
    if (!returnFocus) return;
    cancelFocusReturn();
    // Wait for React's commit so an action that opens and focuses an editor
    // wins. Restore only focus lost by removing the focused menu item.
    focusReturnFrame.current = requestAnimationFrame(() => {
      focusReturnFrame.current = null;
      if (focusedItem.isConnected) return;
      const current = document.activeElement;
      if (current === focusedItem || current === document.body || current === document.documentElement) {
        triggerRef.current?.focus({ preventScroll: true });
      }
    });
  }

  return (
    <div
      ref={rootRef}
      className={`action-menu ${className}`.trim()}
      data-align={align}
      data-placement={placement}
    >
      <button
        ref={triggerRef}
        type="button"
        className="action-menu-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={label}
        onClick={() => { cancelFocusReturn(); setOpen((value) => !value); }}
      >
        {trigger}
      </button>
      {open && (
        <div id={panelId} className="action-menu-panel" onClick={dismissAfterAction}>
          {children}
        </div>
      )}
    </div>
  );
}
