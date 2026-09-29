const cache = new WeakMap();
const chapterPattern = /^(?:第\s*[\d０-９一二三四五六七八九十百零〇两]+\s*章|chapter\s+(?:\d+|[ivxlc]+)\b)\s*[:：.．-]?\s*(.*)$/i;
const sectionPattern = /^(\d{1,2}(?:\s*[.．]\s*\d{1,2}){1,4})[.．、]?\s+(.+)$/;

/** IDs follow physical page locations, independent of OCR title corrections. */
export function sectionId(sourceId, page, level = 1, ordinal = 0) {
  return `${sourceId}@${page}:${level}${ordinal ? `:${ordinal}` : ""}`;
}

/** Normalize a flat preorder into physical ranges and explicit parent links. */
export function normalizeSourceSections(sourceId, starts, totalPages) {
  const valid = starts.filter((item) => item && Number.isInteger(item.page) && item.page >= 1 &&
    item.page <= totalPages && typeof item.title === "string" && item.title.trim())
    .map((item, order) => ({ ...item, title: item.title.trim(), level: Math.max(1, Math.min(8, Math.trunc(item.level) || 1)), order }))
    .sort((a, b) => a.page - b.page || a.order - b.order);
  const counters = new Map();
  const stack = [];
  return valid.map((item, index) => {
    const location = `${item.page}:${item.level}`;
    const ordinal = counters.get(location) || 0;
    counters.set(location, ordinal + 1);
    const id = sectionId(sourceId, item.page, item.level, ordinal);
    while (stack.length && stack.at(-1).level >= item.level) stack.pop();
    const parentId = stack.at(-1)?.id;
    const next = valid.slice(index + 1).find((entry) => entry.level <= item.level);
    const inferredEnd = Math.max(item.page, (next?.page || totalPages + 1) - 1);
    const explicitEnd = Number.isInteger(item.endPage) && item.endPage >= item.page
      ? Math.min(item.endPage, totalPages, inferredEnd) : inferredEnd;
    const section = {
      id, title: item.title, page: item.page, endPage: explicitEnd, level: item.level,
      ...(parentId ? { parentId } : {}),
      kind: ["chapter", "section", "document", "pages"].includes(item.kind)
        ? item.kind : item.level === 1 ? "chapter" : "section",
    };
    stack.push(section);
    return section;
  });
}

/** Resolve public PDF outline destinations without reading PDF bytes again. */
export async function readPdfOutlineSections(pdf, sourceId, totalPages = pdf.numPages, isCurrent = () => true) {
  const outline = await pdf.getOutline();
  const starts = [];
  async function visit(items, level) {
    for (const item of items || []) {
      if (!isCurrent()) return;
      let page = null;
      try {
        const destination = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        if (!isCurrent()) return;
        const target = Array.isArray(destination) ? destination[0] : null;
        if (Number.isInteger(target) && target >= 0) page = target + 1;
        else if (target && typeof target === "object" && Number.isInteger(target.num))
          page = await pdf.getPageIndex(target) + 1;
      } catch { /* A malformed/external destination does not invalidate other entries. */ }
      if (!isCurrent()) return;
      const valid = Number.isInteger(page) && page >= 1 && page <= totalPages && typeof item.title === "string" && item.title.trim();
      if (valid) starts.push({ title: item.title, page, level, kind: level === 1 ? "chapter" : "section" });
      // Invalid destinations cannot establish a physical parent boundary.
      // Their valid children remain addressable at the nearest valid level.
      await visit(item.items, valid ? level + 1 : level);
    }
  }
  await visit(outline, 1);
  return normalizeSourceSections(sourceId, starts, totalPages);
}

function pageBands(first, last) {
  const result = [];
  for (let page = first; page <= last; page += 16) {
    const endPage = Math.min(page + 15, last);
    result.push({ title: page === endPage ? `第 ${page} 页` : `第 ${page}–${endPage} 页`, page, endPage, level: 1, kind: "pages" });
  }
  return result;
}

function isContents(lines) {
  return lines.slice(0, 3).some((line) => /^(?:目\s*录|contents|table\s+of\s+contents)$/i.test(line.replace(/^#+\s*/, ""))) ||
    lines.filter((line) => /\.{3,}|…{2,}|(?:\.\s*){5,}/.test(line)).length >= 3 ||
    lines.filter((line) => /(?:第\s*\S+\s*章|^\d+(?:\s*\.\s*\d+)*)\s*\S.*\s\d{1,4}$/.test(line)).length >= 3;
}

function shortTitle(title) {
  return title.length > 0 && title.length <= 72 && !/[。！？；，!?;]/.test(title) &&
    !/\s\d{1,4}$/.test(title) && !/\.{3,}|…{2,}/.test(title);
}

function textSections(pages) {
  const candidates = [];
  pages.forEach((text, index) => {
    const lines = String(text || "").slice(0, 1800).split(/\n/).map((line) => line.trim()).filter(Boolean);
    if (isContents(lines)) return;
    for (const [lineIndex, raw] of lines.slice(0, 10).entries()) {
      const markdown = raw.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
      let title = markdown?.[2] || raw;
      // A leading or trailing printed page number is evidence of a running
      // header, not a reliable chapter boundary. Never subtract that number.
      if (!markdown && (/^\d+\s+第\s*/.test(title) || /\s\d{1,4}$/.test(title))) continue;
      let chapter = title.match(chapterPattern);
      if (chapter && !chapter[1] && shortTitle(lines[lineIndex + 1] || "") &&
          !sectionPattern.test(lines[lineIndex + 1]) && !chapterPattern.test(lines[lineIndex + 1])) {
        title = `${title} ${lines[lineIndex + 1]}`;
        chapter = title.match(chapterPattern);
      }
      const numbered = title.match(sectionPattern);
      if (!shortTitle(title) || (!markdown && lineIndex > 5)) continue;
      if (chapter?.[1]) {
        candidates.push({ page: index + 1, title, level: 1, kind: "chapter", strong: Boolean(markdown) });
      } else if (numbered) {
        const label = numbered[1].replace(/\s/g, "").replaceAll("．", ".");
        candidates.push({ page: index + 1, title: `${label} ${numbered[2]}`, level: label.split(".").length, kind: "section", strong: Boolean(markdown) });
      } else if (markdown) {
        const level = markdown[1].length;
        candidates.push({ page: index + 1, title, level, kind: level === 1 ? "chapter" : "section", strong: true });
      }
    }
  });
  const canonical = (item) => item.title.replace(/\s/g, "").toLowerCase();
  const occurrences = new Map();
  for (const candidate of candidates) {
    const key = canonical(candidate);
    if (!occurrences.has(key)) occurrences.set(key, new Set());
    occurrences.get(key).add(candidate.page);
  }
  const seen = new Set();
  const seenStrong = new Set();
  return candidates.filter((candidate) => {
    const key = canonical(candidate);
    // Repeated bare headings are often OCR running headers. Even their first
    // occurrence does not establish the real beginning of that chapter.
    if (!candidate.strong && occurrences.get(key).size > 1) return false;
    if (candidate.strong) {
      if (seenStrong.has(key)) return false;
      seenStrong.add(key);
    }
    const location = `${candidate.page}:${key}`;
    if (seen.has(location)) return false;
    seen.add(location);
    return true;
  });
}

function githubSections(source) {
  const documents = new Map();
  for (const chunk of source.chunks || []) {
    if (!chunk.path || !Number.isInteger(chunk.page) || chunk.page < 1 || chunk.page > source.pages.length) continue;
    const existing = documents.get(chunk.path);
    if (existing) {
      existing.page = Math.min(existing.page, chunk.page);
      existing.endPage = Math.max(existing.endPage, chunk.page);
    } else documents.set(chunk.path, { title: chunk.path, page: chunk.page, endPage: chunk.page, level: 1, kind: "document" });
  }
  return [...documents.values()].sort((a, b) => a.page - b.page || a.title.localeCompare(b.title));
}

/** Pure, cached source navigation. Every range uses source.pages indices. */
export function sourceSections(source) {
  if (!source?.pages?.length) return [];
  let bySource = cache.get(source.pages);
  if (!bySource) cache.set(source.pages, bySource = new Map());
  const key = `${source.id}:${source.kind}`;
  const saved = bySource.get(key);
  if (saved && saved.chunks === source.chunks && saved.outline === source.outline) return saved.result;
  let result = Array.isArray(source.outline) && source.outline.length
    ? normalizeSourceSections(source.id, source.outline, source.pages.length) : [];
  if (!result.length) {
    let starts = source.kind === "github" ? githubSections(source) : textSections(source.pages);
    if (!starts.length) starts = pageBands(1, source.pages.length);
    else if (starts[0].page > 1) starts = [...pageBands(1, starts[0].page - 1), ...starts];
    result = normalizeSourceSections(source.id, starts, source.pages.length);
  }
  bySource.set(key, { chunks: source.chunks, outline: source.outline, result });
  return result;
}
