/** The reading line stays close to the top, where readers resume scanning. */
export function readingLine(viewportHeight) {
  return Math.min(120, Math.max(0, viewportHeight) * 0.25);
}

/** A scoped reader keeps the source's physical numbering and never widens an invalid range. */
export function readingPageRange(totalPages, requested) {
  const total = Number.isFinite(totalPages) ? Math.max(0, Math.floor(totalPages)) : 0;
  if (!total) return { start: 1, end: 0 };
  const start = Number.isFinite(requested?.start)
    ? Math.max(1, Math.min(total, Math.ceil(requested.start))) : 1;
  const end = Number.isFinite(requested?.end)
    ? Math.max(start, Math.min(total, Math.floor(requested.end))) : total;
  return { start, end };
}

export function clampReadingPage(page, range) {
  if (range.end < range.start) return range.start;
  return Math.max(range.start, Math.min(range.end, Number.isFinite(page) ? Math.trunc(page) : range.start));
}

/** Page bounds are expressed in the scroll container's content coordinates. */
export function captureReadingAnchor(pages, scrollTop, viewportHeight) {
  if (!pages.length) return null;
  const line = scrollTop + readingLine(viewportHeight);
  const page = pages.find((item) => item.top + item.height > line) || pages.at(-1);
  return {
    page: page.page,
    offset: Math.max(0, Math.min(1, (line - page.top) / Math.max(1, page.height))),
  };
}

export function restoreReadingAnchor(anchor, pages, viewportHeight) {
  const page = pages.find((item) => item.page === anchor?.page);
  if (!page) return null;
  return Math.max(
    0,
    page.top + Math.max(0, Math.min(1, anchor.offset)) * page.height - readingLine(viewportHeight),
  );
}

/** A remembered offset must never override a deliberate page or citation jump. */
export function canRestoreReadingSession(saved, page, navigationKey, evidenceText) {
  return Boolean(
    saved && saved.anchor?.page === page && saved.navigationKey === navigationKey &&
    (!evidenceText || evidenceText === saved.evidenceText),
  );
}
