import type { PDFPageProxy } from "pdfjs-dist";
import { pdfEngine } from "./pdf-engine";
import { paintScanImage, scanPagePlan, type ScanImage } from "../pdf-scan-raster.mjs";

/** Return false for anything beyond a single image + invisible OCR page. */
export async function rasterizePdfScan(page: PDFPageProxy, canvas: HTMLCanvasElement,
  viewport: ReturnType<PDFPageProxy["getViewport"]>): Promise<boolean> {
  try {
    const engine = await pdfEngine();
    const operators = await page.getOperatorList({ intent: "display" });
    const plan = scanPagePlan(operators, engine.OPS, viewport);
    if (!plan) return false;
    const objects = plan.imageId.startsWith("g_") ? page.commonObjs : page.objs;
    const image = await new Promise<ScanImage | null>(resolve => objects.get(plan.imageId, resolve));
    const context = canvas.getContext("2d");
    if (!context || !image) return false;
    return paintScanImage(context, image, plan, (width, height) => {
      const buffer = document.createElement("canvas");
      buffer.width = width; buffer.height = height;
      return buffer;
    }, window.devicePixelRatio || 1);
  } catch {
    // Decoding/API mismatches leave the standard display renderer in charge.
    return false;
  }
}
