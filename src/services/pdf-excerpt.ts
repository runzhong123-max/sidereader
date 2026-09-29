import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfEngine } from "./pdf-engine";
import { loadPdf } from "./source-files";
import { readPdfText } from "../pdf-text.mjs";
import { locatePdfFormulae } from "../pdf-excerpt-layout.mjs";
import { rasterizePdfScan } from "./pdf-scan-raster";

export type OriginalFormula = {
  label: string;
  image: string;
  width: number;
  height: number;
  start?: number;
  end?: number;
  context?: string;
};

// Local-only presentation cache. Original evidence and stored PDFs are never
// rewritten. The queue also keeps several expanded citations from rasterizing
// large pages simultaneously.
const documents = new Map<string, PDFDocumentProxy>();
const excerpts = new Map<string, Promise<OriginalFormula[]>>();
let queue: Promise<unknown> = Promise.resolve();

async function documentFor(sourceId: string) {
  const cached = documents.get(sourceId);
  if (cached) return cached;
  const data = await loadPdf(sourceId);
  if (!data) return null;
  const engine = await pdfEngine();
  const pdf = await engine.getDocument({
    data: data.slice(0), cMapUrl: "/pdfjs/cmaps/", cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/",
  }).promise;
  documents.set(sourceId, pdf);
  if (documents.size > 2) {
    const oldest = documents.keys().next().value!;
    const old = documents.get(oldest);
    documents.delete(oldest);
    await old?.loadingTask.destroy();
  }
  return pdf;
}

export function originalFormulae(sourceId: string, pageNumber: number, text: string, onProgress?: (stage: string) => void): Promise<OriginalFormula[]> {
  // The layout matcher needs a real equation reference. Plain prose uses the
  // lightweight text renderer without loading the PDF engine.
  if (!sourceId || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || !/[（(]\s*(?:[A-Za-z]\s*[.\-]\s*)?\d+(?:\s*[.\-]\s*\d+)*\s*[)）]/.test(text)) return Promise.resolve([]);
  const key = JSON.stringify([sourceId, pageNumber, text]);
  const cached = excerpts.get(key);
  if (cached) return cached;
  const task = queue.then(async () => {
    onProgress?.("pdf");
    const pdf = await documentFor(sourceId);
    if (!pdf || pageNumber > pdf.numPages) return [];
    const page = await pdf.getPage(pageNumber);
    onProgress?.("locating");
    const base = page.getViewport({ scale: 1 });
    const content = await readPdfText(page);
    const matches = locatePdfFormulae(content.items, base, text, { maxCrops: 8 });
    if (!matches.length) return [];
    const scale = Math.min(3, 1800 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
      onProgress?.("rendering");
      // Display intent preserves the same annotation/optional-content policy
      // as the main reader. No OCR or other network inference is involved.
      if (!await rasterizePdfScan(page, canvas, viewport))
        await page.render({ canvas, viewport }).promise;
      return matches.map(match => {
        const { x, y, width, height } = match.bounds;
        const crop = document.createElement("canvas");
        crop.width = Math.ceil(width * scale);
        crop.height = Math.ceil(height * scale);
        crop.getContext("2d")!.drawImage(canvas, x * scale, y * scale, width * scale, height * scale, 0, 0, crop.width, crop.height);
        const image = crop.toDataURL("image/png");
        crop.width = crop.height = 0;
        return { label: match.label, image, width, height, start: match.start, end: match.end,
          ...("context" in match && typeof match.context === "string" ? { context: match.context } : {}) };
      });
    } finally {
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  });
  const safe = task.catch(error => { excerpts.delete(key); throw error; });
  queue = safe.catch(() => {});
  excerpts.set(key, safe);
  if (excerpts.size > 24) excerpts.delete(excerpts.keys().next().value!);
  return safe;
}
