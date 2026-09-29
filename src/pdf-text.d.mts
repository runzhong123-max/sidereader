import type { PDFPageProxy } from "pdfjs-dist";
export function readPdfText(
  page: PDFPageProxy,
): ReturnType<PDFPageProxy["getTextContent"]>;
