export interface ReadingAnchor {
  page: number;
  offset: number;
}
export interface PageBounds {
  page: number;
  top: number;
  height: number;
}
export interface ReadingSession {
  anchor: ReadingAnchor | null;
  zoom: number;
  textMode: boolean;
  navigationKey?: string | number;
  evidenceText?: string;
}
export function readingLine(viewportHeight: number): number;
export function readingPageRange(totalPages: number, requested?: { start: number; end: number }): { start: number; end: number };
export function clampReadingPage(page: number, range: { start: number; end: number }): number;
export function captureReadingAnchor(pages: PageBounds[], scrollTop: number, viewportHeight: number): ReadingAnchor | null;
export function restoreReadingAnchor(anchor: ReadingAnchor | null, pages: PageBounds[], viewportHeight: number): number | null;
export function canRestoreReadingSession(saved: ReadingSession | undefined, page: number, navigationKey?: string | number, evidenceText?: string): boolean;
