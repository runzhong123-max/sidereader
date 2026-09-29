import { useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { pdfEngine } from "../services/pdf-engine";
import { readPdfText } from "../pdf-text.mjs";

/** Only mounted for pages near the viewport; off-screen canvases are released. */
export default function PdfPage({
  pdf,
  number,
  scale,
  pixelRatio,
  onReady,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  scale: number;
  pixelRatio: number;
  onReady: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const generation = useRef(0);
  const bitmapIdentity = useRef<{ pdf: PDFDocumentProxy; number: number } | null>(null);
  useLayoutEffect(() => {
    const token = ++generation.current;
    let cancelled = false;
    let bitmapCommitted = false;
    let render: RenderTask | undefined;
    let layer: { cancel: () => void } | undefined;
    const element = canvas.current!;
    const container = textLayer.current!;
    const buffer = document.createElement("canvas");
    const stagedText = document.createElement("div");
    stagedText.className = "textLayer";
    const isCurrent = () => !cancelled && generation.current === token;
    const samePage = bitmapIdentity.current?.pdf === pdf && bitmapIdentity.current?.number === number;
    setError("");
    if (!samePage) {
      // A new identity must never display the previous document's page, even
      // for the frame before this asynchronous render starts.
      bitmapIdentity.current = null;
      element.width = 0;
      element.height = 0;
      delete element.dataset.ready;
      setReady(false);
    }
    // Keep the same page's previous bitmap while it scales with its parent.
    // Its old transparent text geometry is not accurate at the new size.
    container.style.visibility = "hidden";
    container.setAttribute("aria-hidden", "true");
    container.replaceChildren();
    (async () => {
      try {
        const pdfPage = await pdf.getPage(number);
        if (!isCurrent()) return;
        const viewport = pdfPage.getViewport({ scale });
        // Supersample on ordinary displays and honor Retina/browser zoom.
        // Bound each bitmap instead of capping all displays at 2x.
        const dpr = Math.min(
          Math.max(2, pixelRatio * 1.5),
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
          8192 / Math.max(viewport.width, viewport.height),
        );
        buffer.width = Math.ceil(viewport.width * dpr);
        buffer.height = Math.ceil(viewport.height * dpr);
        const parameters = {
          canvas: buffer,
          viewport,
          transform: [dpr, 0, 0, dpr, 0, 0],
        };
        render = pdfPage.render(parameters);
        // Safari may pause display rendering in a background tab. Keep the
        // previous bitmap until it resumes: print intent can change which
        // annotations and optional layers appear, so it is not a safe fallback.
        await render.promise;
        if (!isCurrent()) return;
        const context = element.getContext("2d");
        if (!context) throw new Error("页面画布暂时不可用，请重新打开材料。");
        // Commit dimensions and pixels synchronously. Resizing the visible
        // canvas earlier would erase the readable page during every drag frame.
        element.width = buffer.width;
        element.height = buffer.height;
        context.drawImage(buffer, 0, 0);
        bitmapIdentity.current = { pdf, number };
        bitmapCommitted = true;
        element.dataset.ready = "true";
        setReady(true);
        // Rendering has settled; the staging bitmap need not remain allocated
        // while PDF text extraction and selection geometry are prepared.
        buffer.width = 0;
        buffer.height = 0;
        stagedText.style.setProperty("--scale-factor", String(scale));
        stagedText.style.setProperty("--total-scale-factor", String(scale));
        const engine = await pdfEngine();
        const text = await readPdfText(pdfPage);
        if (!isCurrent()) return;
        const nextLayer = new engine.TextLayer({
          textContentSource: text,
          container: stagedText,
          viewport,
        });
        layer = nextLayer;
        await nextLayer.render();
        if (!isCurrent()) return;
        container.style.cssText = stagedText.style.cssText;
        container.replaceChildren(...stagedText.childNodes);
        container.removeAttribute("aria-hidden");
        onReady();
      } catch (e) {
        if (isCurrent() && (e as Error).name !== "RenderingCancelledException") {
          setError((e as Error).message);
          // A text-layer failure should not keep the successfully drawn page
          // from being available to Reader's page-image capture.
          if (bitmapCommitted) onReady();
        }
      } finally {
        // Cancellation may still be unwinding PDF.js's canvas work. Only free
        // its private buffer after that work has completely stopped.
        await Promise.resolve(render?.promise).catch(() => {});
        buffer.width = 0;
        buffer.height = 0;
        stagedText.replaceChildren();
      }
    })();
    return () => {
      cancelled = true;
      generation.current += 1;
      render?.cancel();
      layer?.cancel();
      // Preserve a mounted page during scale changes; only a removed page's
      // visible bitmap should be released. Every render owns its own buffer.
      void Promise.resolve(render?.promise)
        .catch(() => {})
        .then(() => {
          if (!element.isConnected) {
            element.width = 0;
            element.height = 0;
          }
        });
    };
  }, [pdf, number, scale, pixelRatio, onReady]);
  return (
    <>
      <canvas
        ref={canvas}
        style={{ width: "100%", height: "100%" }}
        role="img"
        aria-label={`PDF 第 ${number} 页${ready ? "原页" : "正在绘制"}`}
      />
      <div className="textLayer" ref={textLayer} />
      {!ready && !error && (
        <div className="pdf-render-status" role="status">
          正在绘制第 {number} 页…
        </div>
      )}
      {error && (
        <div className="inline-notice">
          第 {number} 页：{error}
        </div>
      )}
    </>
  );
}
