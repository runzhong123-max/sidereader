import { useLayoutEffect, useRef, type ReactNode } from "react";

type ScrollAnchor = {
  index: number;
  key?: string;
  text: string;
  offset: number;
  scrollTop: number;
};

// Keep small position records, never DOM nodes or document contents. A session
// key should identify a project and reference object, not its layout width.
const positions = new Map<string, ScrollAnchor>();
const POSITION_LIMIT = 120;
const documentSelector = ".reference-document, .path-page, .paper-workspace";
const candidateSelector = `:is(${documentSelector}) :is(p, h1, h2, h3, figure, ul)`;

function elementKey(element: HTMLElement) {
  return element.dataset.scrollAnchor || element.id || undefined;
}

function textSignature(element: HTMLElement) {
  return (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function remember(sessionKey: string, anchor: ScrollAnchor) {
  positions.delete(sessionKey);
  positions.set(sessionKey, anchor);
  if (positions.size > POSITION_LIMIT) {
    const oldestKey = positions.keys().next().value;
    if (oldestKey !== undefined) positions.delete(oldestKey);
  }
}

/** A scroll owner for reference documents, independent of the main reader. */
export default function ReferenceScroll({ sessionKey, children }: {
  sessionKey: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let anchor = positions.get(sessionKey);
    let candidates: HTMLElement[] = [];
    let restoring = false;
    let restoreFrame = 0;
    let releaseFrame = 0;
    let lastWidth = root.clientWidth;
    let lastHeight = root.clientHeight;
    let observedDocument: Element | null = null;

    function refreshCandidates() {
      candidates = Array.from(root!.querySelectorAll<HTMLElement>(candidateSelector))
        // A list with paragraph children would otherwise mask the paragraph
        // that is actually at the top of the viewport.
        .filter((element) => element.tagName !== "UL" || !element.querySelector("p, h2, h3, figure"));
    }

    function capture() {
      if (!root!.clientWidth || !root!.clientHeight) return;
      const viewport = root!.getBoundingClientRect();
      const top = viewport.top + root!.clientTop;
      const bottom = top + root!.clientHeight;
      let selected: { element: HTMLElement; index: number; top: number } | undefined;
      for (let index = 0; index < candidates.length; index++) {
        const element = candidates[index];
        const rect = element.getBoundingClientRect();
        if (!rect.height || rect.bottom <= top + 1 || rect.top >= bottom) continue;
        // Prefer the innermost visible block crossing the viewport edge;
        // otherwise keep the first visible block below it.
        if (!selected || (rect.top <= top && (selected.top > top || rect.top > selected.top)) ||
          (rect.top > top && selected.top > top && rect.top < selected.top)) {
          selected = { element, index, top: rect.top };
        }
      }
      if (!selected) return;
      anchor = {
        index: selected.index,
        key: elementKey(selected.element),
        text: textSignature(selected.element),
        offset: top - selected.top,
        scrollTop: root!.scrollTop,
      };
      remember(sessionKey, anchor);
    }

    function restore() {
      if (!root!.clientWidth || !root!.clientHeight) return;
      lastWidth = root!.clientWidth;
      lastHeight = root!.clientHeight;
      restoring = true;
      cancelAnimationFrame(releaseFrame);
      if (anchor) {
        const indexedTarget = candidates[anchor.index];
        const target = (anchor.key ? candidates.find((element) => elementKey(element) === anchor!.key) : undefined)
          || (indexedTarget && textSignature(indexedTarget) === anchor.text ? indexedTarget : undefined)
          || (anchor.text ? candidates.find((element) => textSignature(element) === anchor!.text) : undefined)
          || indexedTarget;
        if (target) {
          const top = root!.getBoundingClientRect().top + root!.clientTop;
          root!.scrollTop += target.getBoundingClientRect().top - top + anchor.offset;
        } else {
          // A lazy reference may still show a loading placeholder. Preserve the
          // saved anchor for the mutation/resize notification after it loads.
          root!.scrollTop = anchor.scrollTop;
        }
      } else {
        root!.scrollTop = 0;
        capture();
      }
      releaseFrame = requestAnimationFrame(() => { restoring = false; });
    }

    function scheduleRestore() {
      cancelAnimationFrame(restoreFrame);
      restoreFrame = requestAnimationFrame(restore);
    }

    function onScroll() {
      if (restoring) return;
      if (root!.clientWidth !== lastWidth || root!.clientHeight !== lastHeight) {
        // Layout can emit a scroll event before ResizeObserver. Do not replace
        // the old paragraph anchor with a position from the new geometry.
        restore();
        return;
      }
      capture();
    }

    const resizeObserver = new ResizeObserver(scheduleRestore);
    function observeDocument() {
      const nextDocument = root!.querySelector(documentSelector);
      if (nextDocument === observedDocument) return;
      if (observedDocument) resizeObserver.unobserve(observedDocument);
      observedDocument = nextDocument;
      if (observedDocument) resizeObserver.observe(observedDocument);
    }
    const mutationObserver = new MutationObserver(() => {
      refreshCandidates();
      observeDocument();
      scheduleRestore();
    });

    refreshCandidates();
    restore();
    resizeObserver.observe(root);
    observeDocument();
    mutationObserver.observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      // Scroll events already stored the last position. Reading DOM here could
      // capture a different reference after React has swapped the children.
      cancelAnimationFrame(restoreFrame);
      cancelAnimationFrame(releaseFrame);
      root.removeEventListener("scroll", onScroll);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [sessionKey]);

  return (
    <div
      ref={rootRef}
      className="reference-scroll"
      style={{ height: "100%", minHeight: 0, overflow: "auto", overflowAnchor: "none", overscrollBehavior: "contain", scrollBehavior: "auto" }}
    >
      {children}
    </div>
  );
}
