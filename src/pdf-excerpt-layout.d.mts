import type { TextContent } from "pdfjs-dist/types/src/display/api";
export interface PdfExcerptSpan { text: string; x: number; y: number; width: number; height: number }
export interface PdfExcerptViewport { width: number; height: number; transform?: number[] }
export interface PdfFormulaCrop {
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  /** Original PDF text; useful for matching only, never a reconstructed formula. */
  text: string;
  /** Nearby introduction, present verbatim (apart from whitespace) in excerpt. */
  context?: string;
  /** Original excerpt offsets, omitted unless same-line replacement is reliable. */
  start?: number;
  end?: number;
}
export function locatePdfFormulae(items: TextContent["items"] | PdfExcerptSpan[], viewport: PdfExcerptViewport,
  excerpt: string, options?: { maxCrops?: number }): PdfFormulaCrop[];
