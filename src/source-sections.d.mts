import type { Source, SourceSection } from "./types";
import type { PDFDocumentProxy } from "pdfjs-dist";
export function sectionId(sourceId: string, page: number, level?: number, ordinal?: number): string;
export function normalizeSourceSections(sourceId: string, starts: Array<{ title: string; page: number; level?: number; endPage?: number; kind?: string }>, totalPages: number): SourceSection[];
export function sourceSections(source: Pick<Source, "id" | "kind" | "pages" | "chunks" | "outline"> | undefined): SourceSection[];
export function readPdfOutlineSections(pdf: Pick<PDFDocumentProxy, "getOutline" | "getDestination" | "getPageIndex" | "numPages">, sourceId: string, totalPages?: number, isCurrent?: () => boolean): Promise<SourceSection[]>;
