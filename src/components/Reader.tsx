import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  List,
  Minus,
  Plus,
  SlidersHorizontal,
  BookOpen,
  Loader2,
  Bookmark,
  X,
  MessageSquare,
  Copy,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightEvidence } from "../highlight";
import type { Source, SourceSection, Bookmark as ReadingBookmark } from "../types";
import { selectionToolbarPosition, sameBookmarkExcerpt } from "../reader-selection.mjs";
import { readPdfOutlineSections } from "../source-sections.mjs";
import { loadPdf } from "../services/source-files";
import { pdfEngine } from "../services/pdf-engine";
import type { PDFDocumentProxy } from "pdfjs-dist";
import PdfPage from "./PdfPage";
import ActionMenu from "./ActionMenu";
import {
  captureReadingAnchor,
  restoreReadingAnchor,
  canRestoreReadingSession,
  readingLine,
  readingPageRange,
  clampReadingPage,
} from "../reader-viewport.mjs";
import "../reader-continuity.css";

import { getReaderSession, saveReaderSession, readerSessionRevision, registerReaderSession, subscribeReaderSession, type ReaderSessionSnapshot } from "../reader-sessions.mjs";

function pageBounds(root: HTMLElement, number?: number) {
  const top = root.getBoundingClientRect().top;
  const elements = root.querySelectorAll<HTMLElement>(number ? `[data-page="${number}"]` : "[data-page]");
  return Array.from(elements).map((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      page: Number(element.dataset.page),
      top: bounds.top - top + root.scrollTop,
      height: bounds.height,
    };
  });
}

function captureViewport(root: HTMLElement) {
  const pages = root.querySelectorAll<HTMLElement>("[data-page]");
  if (!pages.length) return null;
  const line = root.getBoundingClientRect().top + readingLine(root.clientHeight);
  // Hundreds of PDF pages need only a handful of geometry reads per scroll.
  let left = 0;
  let right = pages.length - 1;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (pages[middle].getBoundingClientRect().bottom <= line) left = middle + 1;
    else right = middle;
  }
  return captureReadingAnchor(pageBounds(root, Number(pages[left].dataset.page)), root.scrollTop, root.clientHeight);
}

export default function Reader({
  source,
  page: requestedPage,
  onPage,
  onSelection,
  tutorOpen,
  onTutor,
  evidenceText,
  onVisibleText,
  onPageImage,
  bookmarked,
  onBookmark,
  bookmarks,
  onBookmarkSelection,
  navigationKey,
  onOutline,
  sessionKey,
  pageRange,
  returnTo,
}: {
  source?: Source;
  page: number;
  onPage: (p: number) => void;
  onSelection: (s: string, page: number) => void;
  tutorOpen: boolean;
  onTutor: () => void;
  evidenceText?: string;
  onVisibleText?: (text: string, page: number) => void;
  onPageImage?: (image: string, page: number) => void;
  bookmarked?: boolean;
  onBookmark?: () => void;
  bookmarks?: ReadingBookmark[];
  onBookmarkSelection?: (text: string, page: number) => void;
  /** Change only for explicit navigation, including repeated same-page citations. */
  navigationKey?: string | number;
  onOutline?: (sections: SourceSection[]) => void;
  /** Independent chapter/paper positions may share the same loaded source. */
  sessionKey?: string;
  /** Restrict a chapter view while retaining the source's physical page numbers. */
  pageRange?: { start: number; end: number };
  /** Return to the discussion or learning object that opened this PDF reference. */
  returnTo?: { title: string; onReturn: () => void };
}) {
  const range = readingPageRange(source?.pages.length || 0, pageRange);
  const page = clampReadingPage(requestedPage, range);
  const [toc, setToc] = useState(false);
  const [pageInput, setPageInput] = useState(String(page));
  const readerSessionId = sessionKey || source?.id;
  const transferRevision = useSyncExternalStore(
    useCallback((listener) => subscribeReaderSession(readerSessionId, listener), [readerSessionId]),
    useCallback(() => readerSessionRevision(readerSessionId), [readerSessionId]),
    () => 0,
  );
  const cachedSession = getReaderSession(readerSessionId);
  const remembered = cachedSession?.sourceId === source?.id ? cachedSession : undefined;
  const [textMode, setTextMode] = useState(() => remembered?.textMode ?? false);
  const [zoom, setZoom] = useState(() => remembered?.zoom ?? 100);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(source?.kind === "pdf");
  const [settledSourceId, setSettledSourceId] = useState<string>();
  const outlineCallback = useRef(onOutline);
  outlineCallback.current = onOutline;
  const visibleTextCallback = useRef(onVisibleText);
  visibleTextCallback.current = onVisibleText;
  const pageImageCallback = useRef(onPageImage);
  pageImageCallback.current = onPageImage;
  const outlineReported = useRef(new Set<string>());
  const [selectedText, setSelectedText] = useState("");
  const selectedRange = useRef<Range | null>(null);
  const selectedPage = useRef(page);
  const selectionToolbar = useRef<HTMLDivElement>(null);
  const [selectionPosition, setSelectionPosition] = useState<{left:number;top:number} | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const [nearby, setNearby] = useState<Set<number>>(new Set());
  const [availableWidth, setAvailableWidth] = useState(760);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [pixelRatio, setPixelRatio] = useState(
    () => window.devicePixelRatio || 1,
  );
  useEffect(() => {
    let media: MediaQueryList;
    const update = () => {
      media?.removeEventListener("change", update);
      const ratio = window.devicePixelRatio || 1;
      setPixelRatio(ratio);
      media = window.matchMedia(`(resolution: ${ratio}dppx)`);
      media.addEventListener("change", update);
    };
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const [renderVersion, setRenderVersion] = useState(0);
  const rendered = useCallback(() => setRenderVersion((v) => v + 1), []);
  const reportedPage = useRef(page);
  const pageCallback = useRef(onPage);
  pageCallback.current = onPage;
  useLayoutEffect(() => {
    if (source?.pages.length && requestedPage !== page) pageCallback.current(page);
  }, [source?.id, source?.pages.length, readerSessionId, requestedPage, page]);
  useLayoutEffect(() => { setPageInput(String(page)); }, [page, readerSessionId]);
  const documentArea = useRef<HTMLDivElement>(null);
  const continuity = useRef<ReaderSessionSnapshot>({
    sourceId: source?.id,
    sessionId: readerSessionId,
    transferRevision,
    anchor: canRestoreReadingSession(remembered, page, navigationKey, evidenceText)
      ? remembered!.anchor
      : null,
    zoom,
    textMode,
    navigationKey,
    evidenceText,
  });
  const pendingNavigation = useRef<number | null>(continuity.current.anchor ? null : page);
  const revealEvidence = useRef(Boolean(evidenceText && !continuity.current.anchor));
  const committedViewport = useRef({ width: 0, height: 0 });
  const rememberPosition = useCallback(() => {
    const root = documentArea.current;
    const current = continuity.current;
    if (!root || !current.sourceId || !current.sessionId || root.clientWidth <= 0 || root.clientHeight <= 0) return;
    // A resize has already reflowed text, but its layout effect has not restored
    // the old anchor yet. Do not overwrite that anchor with shifted geometry.
    const metrics = committedViewport.current;
    if (metrics.width !== root.clientWidth || metrics.height !== root.clientHeight) return;
    const anchor = captureViewport(root);
    if (!anchor) return;
    current.anchor = anchor;
    saveReaderSession(current.sessionId, current);
    if (anchor.page !== reportedPage.current) {
      reportedPage.current = anchor.page;
      pageCallback.current(anchor.page);
    }
  }, []);
  useLayoutEffect(() => registerReaderSession(readerSessionId, () => {
    rememberPosition();
    return continuity.current;
  }), [readerSessionId, rememberPosition]);
  const clearSelection = useCallback(() => {
    const selection = window.getSelection();
    if (selection?.anchorNode && documentArea.current?.contains(selection.anchorNode))
      selection.removeAllRanges();
    selectedRange.current = null;
    setSelectedText("");
    setSelectionPosition(null);
    setCopyStatus("");
  }, []);
  useEffect(() => {
    let pointerSelecting = false;
    let frame = 0;
    let previousText = "";
    const readSelection = () => {
      const selection = window.getSelection();
      const root = documentArea.current;
      if (root && (root.clientWidth <= 0 || root.clientHeight <= 0)) return;
      if (!selection || selection.isCollapsed || !selection.rangeCount ||
          !root?.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
        // Keyboard focus may collapse the native selection; actions use its snapshot.
        if (selectionToolbar.current?.contains(document.activeElement)) return;
        selectedRange.current = null;
        setSelectedText("");
        setSelectionPosition(null);
        return;
      }
      const range = selection.getRangeAt(0).cloneRange();
      selectedRange.current = range;
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
      selectedPage.current = Number(start?.closest<HTMLElement>("[data-page]")?.dataset.page) || reportedPage.current;
      const text = selection.toString().trim();
      setSelectedText(text);
      if (text !== previousText) setCopyStatus("");
      previousText = text;
      const box = root.getBoundingClientRect();
      const backwards = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
      setSelectionPosition(!text || pointerSelecting ? null : selectionToolbarPosition(Array.from(range.getClientRects()), {
        left:Math.max(0,box.left),right:Math.min(window.innerWidth,box.right),top:Math.max(0,box.top),bottom:Math.min(window.innerHeight,box.bottom),
      }, {backwards}));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(readSelection); };
    const pointerDown = (event: PointerEvent) => {
      if (selectionToolbar.current?.contains(event.target as Node)) return;
      pointerSelecting = Boolean(documentArea.current?.contains(event.target as Node));
      setSelectionPosition(null);
    };
    const pointerUp = () => { if (pointerSelecting) { pointerSelecting = false; schedule(); } };
    const hide = () => { cancelAnimationFrame(frame); setSelectionPosition(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedRange.current) {
        event.preventDefault();
        const focused = selectionToolbar.current?.contains(document.activeElement);
        clearSelection();
        if (focused) documentArea.current?.focus({preventScroll:true});
      }
    };
    document.addEventListener("selectionchange", readSelection);
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerUp);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", hide);
    const root = documentArea.current;
    root?.addEventListener("scroll", hide, {passive:true});
    readSelection();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", readSelection);
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerUp);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", hide);
      root?.removeEventListener("scroll", hide);
    };
  }, [clearSelection,readerSessionId]);
  function askSelection() {
    if (!selectedText) return;
    onSelection(selectedText,selectedPage.current);
    setSelectionPosition(null);
  }
  async function copySelection() {
    try {
      await navigator.clipboard.writeText(selectedText);
      setCopyStatus("已复制");
    } catch { setCopyStatus("复制失败，请按 ⌘C 复制选区"); }
  }
  useEffect(() => () => {
    const current = continuity.current;
    if (current.sessionId) saveReaderSession(current.sessionId, current);
  }, []);
  useEffect(() => {
    let disposed = false;
    let loaded: PDFDocumentProxy | undefined;
    setPdf(null);
    setSizes([]);
    setNearby(new Set());
    setError("");
    if (source?.kind !== "pdf") {
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const data = await loadPdf(source.id);
        if (!data) throw new Error("原始 PDF 不在本机，当前展示已索引的文字。");
        const engine = await pdfEngine();
        loaded = await engine.getDocument({
          data: data.slice(0),
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
        }).promise;
        // Read only page dimensions up front so distant jumps and the scrollbar
        // remain accurate; rasterize just the pages near the viewport.
        const document = loaded;
        const dimensions = new Array<{ width: number; height: number }>(
          document.numPages,
        );
        let next = 1;
        await Promise.all(
          Array.from({ length: 6 }, async () => {
            while (next <= document.numPages && !disposed) {
              const number = next++;
              const item = await document.getPage(number);
              const view = item.getViewport({ scale: 1 });
              dimensions[number - 1] = {
                width: view.width,
                height: view.height,
              };
            }
          }),
        );
        if (!disposed) {
          setSizes(dimensions);
          setPdf(document);
        } else void document.loadingTask.destroy();
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "PDF 打开失败");
      } finally {
        if (!disposed) {
          setSettledSourceId(source.id);
          setLoading(false);
        }
      }
    })();
    return () => {
      disposed = true;
      if (loaded) void loaded.loadingTask.destroy();
    };
  }, [source?.id, source?.kind]);
  const readingReady = source?.kind !== "pdf" || settledSourceId === source.id;
  const originalPdf = Boolean(source?.kind === "pdf" && pdf && readingReady && !textMode);
  useEffect(() => {
    if (!source || source.kind !== "pdf" || source.outline !== undefined || !pdf ||
        settledSourceId !== source.id || !outlineCallback.current || outlineReported.current.has(source.id)) return;
    let disposed = false;
    void readPdfOutlineSections(pdf, source.id, Math.min(pdf.numPages, source.pages.length), () => !disposed)
      .then((sections) => {
        if (disposed || outlineReported.current.has(source.id)) return;
        outlineReported.current.add(source.id);
        outlineCallback.current?.(sections);
      })
      .catch(() => { /* An unavailable outline must not interrupt reading. */ });
    return () => { disposed = true; };
  }, [pdf, settledSourceId, source?.id, source?.outline, source?.pages.length]);
  const jumpTo = useCallback((number: number) => {
    const root = documentArea.current;
    const target = root?.querySelector<HTMLElement>(`[data-page="${number}"]`);
    if (root && target) {
      root.scrollTop +=
        target.getBoundingClientRect().top -
        root.getBoundingClientRect().top -
        20;
    }
  }, []);
  function navigate(number: number) {
    number = clampReadingPage(number, range);
    setPageInput(String(number));
    clearSelection();
    reportedPage.current = number;
    pendingNavigation.current = number;
    onPage(number);
    jumpTo(number);
    rememberPosition();
    pendingNavigation.current = null;
  }
  function commitPageInput(explicit = false) {
    const target = clampReadingPage(pageInput.trim() ? Number(pageInput) : page, range);
    if (explicit || target !== page) navigate(target);
    else setPageInput(String(page));
  }
  useEffect(() => {
    const root = documentArea.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      // Hidden readers remain mounted while the companion is expanded. Track
      // visibility so revealing the same width still restores the passage.
      setViewportHeight(root.clientHeight);
      if (root.clientWidth <= 0 || root.clientHeight <= 0) return;
      const style = getComputedStyle(root);
      setAvailableWidth(
        Math.max(
          180,
          root.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
        ),
      );
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [source?.id]);
  // Preserve the passage under the reading line as the surrounding workspace
  // changes size. An explicit page/citation navigation always takes precedence.
  useLayoutEffect(() => {
    let current = continuity.current;
    if (current.sourceId !== source?.id || current.sessionId !== readerSessionId || current.transferRevision !== transferRevision) {
      if (current.sessionId) saveReaderSession(current.sessionId, current);
      const candidate = getReaderSession(readerSessionId);
      const saved = candidate?.sourceId === source?.id ? candidate : undefined;
      current = continuity.current = {
        sourceId: source?.id,
        sessionId: readerSessionId,
        transferRevision,
        anchor: canRestoreReadingSession(saved, page, navigationKey, evidenceText) ? saved!.anchor : null,
        zoom: saved?.zoom ?? 100,
        textMode: saved?.textMode ?? false,
        navigationKey,
        evidenceText,
      };
      pendingNavigation.current = current.anchor ? null : page;
      revealEvidence.current = Boolean(evidenceText && !current.anchor);
      reportedPage.current = page;
      clearSelection();
      if (zoom !== current.zoom || textMode !== current.textMode) {
        setZoom(current.zoom);
        setTextMode(current.textMode);
        return;
      }
    }
    const explicitNavigation = page !== reportedPage.current ||
      navigationKey !== current.navigationKey ||
      Boolean(evidenceText && evidenceText !== current.evidenceText);
    if (explicitNavigation) {
      pendingNavigation.current = page;
      revealEvidence.current = Boolean(evidenceText);
      reportedPage.current = page;
      clearSelection();
    }
    Object.assign(current, { zoom, textMode, navigationKey, evidenceText });
    const root = documentArea.current;
    if (!root || !readingReady || loading || root.clientWidth <= 0 || root.clientHeight <= 0) return;
    if (pendingNavigation.current !== null) {
      jumpTo(pendingNavigation.current);
      pendingNavigation.current = null;
    } else {
      const top = restoreReadingAnchor(current.anchor, pageBounds(root, current.anchor?.page), root.clientHeight);
      if (top !== null) root.scrollTop = top;
    }
    committedViewport.current = { width: root.clientWidth, height: root.clientHeight };
    rememberPosition();
  }, [source?.id, readerSessionId, transferRevision, page, range.start, range.end, navigationKey, evidenceText, originalPdf, sizes, zoom,
    textMode, availableWidth, viewportHeight, loading, readingReady, jumpTo, rememberPosition, clearSelection]);
  useEffect(() => {
    const root = documentArea.current;
    if (!root || !originalPdf || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setNearby((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const number = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting) next.add(number);
            else next.delete(number);
          }
          return next;
        });
      },
      { root, rootMargin: "800px 0px" },
    );
    root
      .querySelectorAll("[data-page]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [source?.id, originalPdf, loading, sizes, range.start, range.end]);
  useEffect(() => {
    const root = documentArea.current;
    if (!root || loading || !readingReady) return;
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      if (root.clientWidth <= 0 || root.clientHeight <= 0) return;
      const bounds = root.getBoundingClientRect();
      const marker = bounds.top + Math.min(120, bounds.height * 0.25);
      const pages = Array.from(
        root.querySelectorAll<HTMLElement>("[data-page]"),
      );
      const current = pages.find(
        (el) => el.getBoundingClientRect().bottom > marker,
      );
      const number = Number(current?.dataset.page);
      if (number && number !== reportedPage.current) {
        reportedPage.current = number;
        pageCallback.current(number);
      }
      const visible = Array.from(
        root.querySelectorAll(
          ".textLayer span, .reading-paper p, .reading-paper h1, .reading-paper h2, .reading-paper li",
        ),
      )
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return (
            box.bottom > bounds.top &&
            box.top < bounds.bottom &&
            box.right > bounds.left &&
            box.left < bounds.right
          );
        })
        .map((el) => el.textContent || "")
        .join(" ");
      visibleTextCallback.current?.(visible.slice(0, 4000), number || reportedPage.current);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 100);
    };
    schedule();
    root.addEventListener("scroll", schedule, { passive: true });
    return () => {
      clearTimeout(timer);
      root.removeEventListener("scroll", schedule);
    };
  }, [source?.id, loading, readingReady, originalPdf, renderVersion, range.start, range.end]);
  useEffect(() => {
    const element = documentArea.current?.querySelector<HTMLCanvasElement>(
      `[data-page="${page}"] canvas[data-ready="true"]`,
    );
    if (!element || !originalPdf) {
      pageImageCallback.current?.("",page);
      return;
    }
    // Display resolution should not inflate multimodal request payloads.
    const image = document.createElement("canvas");
    const ratio = Math.min(1, 1800 / Math.max(element.width, element.height));
    image.width = Math.round(element.width * ratio);
    image.height = Math.round(element.height * ratio);
    const context = image.getContext("2d");
    if (!context) return;
    context.drawImage(element, 0, 0, image.width, image.height);
    pageImageCallback.current?.(image.toDataURL("image/jpeg", 0.85),page);
  }, [page, originalPdf, renderVersion]);
  const highlighted = useRef("");
  useEffect(() => {
    highlighted.current = "";
    const root = documentArea.current;
    if (root) highlightEvidence(root, "");
    return () => {
      if (root) highlightEvidence(root, "");
    };
  }, [evidenceText, source?.id, readerSessionId, originalPdf, navigationKey]);
  useEffect(() => {
    if (loading || !evidenceText) return;
    const documentRoot = documentArea.current;
    if (!documentRoot || documentRoot.clientWidth <= 0 || documentRoot.clientHeight <= 0) return;
    const target = documentRoot.querySelector<HTMLElement>(
      `[data-page="${page}"]`,
    );
    const key = `${readerSessionId}:${source?.id}:${page}:${evidenceText}:${originalPdf}:${navigationKey}`;
    if (
      !target ||
      highlighted.current === key ||
      (originalPdf && !target.querySelector(".textLayer span"))
    )
      return;
    highlighted.current = key;
    const preservedAnchor = continuity.current.anchor;
    highlightEvidence(target, evidenceText);
    if (!revealEvidence.current) {
      // Rebuilding a PDF text layer or returning to a tab may recreate its
      // evidence highlight, but must not act like another citation click.
      const root = documentArea.current;
      if (root) {
        const top = restoreReadingAnchor(preservedAnchor, pageBounds(root, preservedAnchor?.page), root.clientHeight);
        if (top !== null) root.scrollTop = top;
      }
    }
    revealEvidence.current = false;
    rememberPosition();
  }, [evidenceText, page, source?.id, readerSessionId, loading, originalPdf, renderVersion, navigationKey, viewportHeight, rememberPosition]);
  if (!source)
    return (
      <div className="empty-state">
        <BookOpen size={35} />
        <h2>从一份材料开始</h2>
        <p>在知识库中导入 PDF 或 GitHub 仓库，再来这里阅读。</p>
      </div>
    );
  return (
    <div className="reader">
      {selectedText && selectionPosition && createPortal(<div ref={selectionToolbar} className="reader-selection-popover" role="toolbar" aria-label="选中文字的操作" style={selectionPosition}
        onPointerDown={(event)=>event.preventDefault()} onMouseDown={(event)=>event.preventDefault()}>
        <button type="button" onClick={askSelection}><MessageSquare size={15}/>追问</button>
        {onBookmarkSelection && <button type="button" disabled={bookmarks?.some((item)=>item.sourceId===source.id && item.page===selectedPage.current && sameBookmarkExcerpt(item.quote,selectedText))}
          onClick={()=>onBookmarkSelection(selectedText,selectedPage.current)}>
          {bookmarks?.some((item)=>item.sourceId===source.id && item.page===selectedPage.current && sameBookmarkExcerpt(item.quote,selectedText)) ? <><Check size={15}/>已加书签</> : <><Bookmark size={15}/>加书签</>}
        </button>}
        <button type="button" onClick={copySelection}>{copyStatus === "已复制" ? <Check size={15}/> : <Copy size={15}/>}<span aria-live="polite">{copyStatus === "已复制" ? "已复制" : "复制"}</span></button>
        {copyStatus.startsWith("复制失败") && <span className="reader-selection-error" role="status">{copyStatus}</span>}
      </div>,document.body)}
      <div className="reader-body">
        {toc && (
          <aside className="toc">
            <span className="eyebrow">阅读目录</span>
            {source.pages.slice(range.start - 1, range.end).map((text, offset) => {
              const number = range.start + offset;
              return (
              <button
                key={number}
                className={page === number ? "active" : ""}
                onClick={() => navigate(number)}
              >
                <span>{String(number).padStart(2, "0")}</span>
                {text.match(/^# (.+)/m)?.[1] || `第 ${number} 页`}
              </button>
              );
            })}
          </aside>
        )}
        <div
          className="document-scroll"
          ref={documentArea}
          data-reader-focus
          tabIndex={0}
          aria-label="原文阅读区"
          onScroll={() => { if (readingReady && !loading) rememberPosition(); }}
        >
          {error && <div className="inline-notice">{error}</div>}
          {(loading || !readingReady) && (
            <div className="pdf-loading">
              <Loader2 size={18} className="spin" />
              正在打开页面…
            </div>
          )}
          {originalPdf && pdf ? (
            <div className="continuous-pages">
              {sizes.slice(range.start - 1, range.end).map((size, offset) => {
                const i = range.start - 1 + offset;
                const scale = ((availableWidth / size.width) * zoom) / 100;
                return (
                  <section
                    key={i}
                    className="pdf-paper continuous-page"
                    data-page={i + 1}
                    aria-label={`第 ${i + 1} 页`}
                    aria-hidden={
                      !nearby.has(i + 1) && Math.abs(i + 1 - page) > 1
                    }
                    style={{
                      width: size.width * scale,
                      height: size.height * scale,
                    }}
                  >
                    {(nearby.has(i + 1) || Math.abs(i + 1 - page) <= 1) && (
                      <PdfPage
                        pdf={pdf}
                        number={i + 1}
                        scale={scale}
                        pixelRatio={pixelRatio}
                        onReady={rendered}
                      />
                    )}
                    <span className="continuous-page-number">{i + 1}</span>
                  </section>
                );
              })}
            </div>
          ) : (
            !loading && readingReady && (
              <div className="continuous-pages continuous-text-pages">
                {source.pages.slice(range.start - 1, range.end).map((text, offset) => (
                  <ReadingTextPage
                    key={range.start + offset}
                    text={text}
                    number={range.start + offset}
                    zoom={zoom}
                    kind={source.kind}
                    author={source.author}
                  />
                ))}
              </div>
            )
          )}
        </div>
      </div>
      <footer className="reader-footer">
        <div className="reader-footer-start">
          {returnTo && <button className="reader-return" aria-label={returnTo.title} title={returnTo.title} onClick={returnTo.onReturn}><ArrowLeft size={15}/><span>{returnTo.title}</span></button>}
          <ActionMenu label="阅读设置" align="start" placement="top" trigger={<><SlidersHorizontal size={15}/><span className="reader-settings-label">阅读设置</span></>}>
            <div className="action-menu-label">{source.title}{source.demo ? " · 示例" : ""}</div>
            <div className="menu-zoom-row" data-menu-keep-open>
              <button aria-label="缩小" disabled={zoom <= 70} onClick={()=>{rememberPosition();setZoom((z)=>z-10);}}><Minus size={15}/></button>
              <button aria-label="适合宽度" onClick={()=>{rememberPosition();setZoom(100);}}>{zoom===100 ? "适合宽度" : `${zoom}%`}</button>
              <button aria-label="放大" disabled={zoom >= 200} onClick={()=>{rememberPosition();setZoom((z)=>z+10);}}><Plus size={15}/></button>
            </div>
            <div className="action-menu-divider"/>
            {source.kind==="pdf" && <button onClick={()=>{rememberPosition();clearSelection();setTextMode(!textMode);}}><BookOpen size={15}/>{textMode ? "查看原页" : "查看提取文本"}</button>}
            {onBookmark && <button aria-pressed={Boolean(bookmarked)} onClick={onBookmark}><Bookmark size={15} fill={bookmarked ? "currentColor" : "none"}/>{bookmarked ? "移除当前页书签" : "收藏当前阅读位置"}</button>}
            <button aria-expanded={toc} onClick={()=>{rememberPosition();setToc(!toc);}}><List size={15}/>{toc ? "收起页目录" : "展开页目录"}</button>
          </ActionMenu>
        </div>
        <div className="pagination">
          <button
            className="icon-button"
            aria-label="上一页"
            disabled={page <= range.start}
            onClick={() => navigate(page - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <label>
            <input
              aria-label="当前页码"
              type="number"
              min={range.start}
              max={range.end}
              disabled={range.end < range.start}
              title={pageRange ? `本章范围：第 ${range.start}–${range.end} 页` : undefined}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={() => commitPageInput()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPageInput(true);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setPageInput(String(page));
                }
              }}
            />{" "}
            / {source.pages.length}
          </label>
          <button
            className="icon-button"
            aria-label="下一页"
            disabled={page >= range.end}
            onClick={() => navigate(page + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="reader-footer-end">
          {selectedText ? (
          <div className="reader-selection-actions" aria-label="选中文字的操作">
            <span className="reader-selection-count">已选 {selectedText.length} 字</span>
            <button
              className="reader-ask-selection"
              onPointerDown={(event) => event.preventDefault()}
              onClick={askSelection}
            >
              <MessageSquare size={13} />选中追问
            </button>
            <button className="icon-button" aria-label="取消文字选择" onClick={clearSelection}>
              <X size={13} />
            </button>
          </div>
          ) : !tutorOpen && <button className="reader-page-question" aria-label="从此页追问" title="围绕当前阅读位置提问" onClick={onTutor}><MessageSquare size={14}/><span>追问</span></button>}
        </div>
      </footer>
    </div>
  );
}

const ReadingTextPage = memo(function ReadingTextPage({
  text,
  number,
  zoom,
  kind,
  author,
}: {
  text: string;
  number: number;
  zoom: number;
  kind: Source["kind"];
  author: string;
}) {
  return (
    <article
      data-page={number}
      className="reading-paper continuous-text-page"
      style={{ fontSize: `${zoom}%` }}
    >
      <div className="paper-eyebrow">
        {kind === "github" ? "REPOSITORY NOTES" : "SIDEREADER / LEARNING NOTES"}
      </div>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="markdown-image-label">
              [图片：{alt || "请查看原始来源"}]
            </span>
          ),
        }}
      >
        {text || "这一页未提取到文本。扫描页可在启用视觉识别后重新导入。"}
      </ReactMarkdown>
      <footer className="paper-footer">
        <span>{author}</span>
        <span>{String(number).padStart(2, "0")}</span>
      </footer>
    </article>
  );
});
