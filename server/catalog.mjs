import { createHash } from "node:crypto";
const cache = new Map();
export function buildCatalog(chunks) {
  const key = createHash("sha256").update(JSON.stringify(chunks)).digest("hex");
  if (cache.has(key)) return { ...cache.get(key), cacheHit: true };
  const sources = new Map();
  for (const c of chunks) {
    if (!sources.has(c.sourceId))
      sources.set(c.sourceId, {
        id: c.sourceId,
        title: c.title,
        pages: new Map(),
      });
    const s = sources.get(c.sourceId);
    if (!s.pages.has(c.page)) s.pages.set(c.page, []);
    s.pages.get(c.page).push(c);
  }
  const sections = [];
  for (const source of sources.values()) {
    const pages = [...source.pages.keys()].sort((a, b) => a - b);
    const starts = [];
    let lastHeading = "",
      lastChapter = 0;
    for (const page of pages) {
      const items = source.pages.get(page);
      const text = items.map((c) => c.text).join("\n");
      const lines = text
        .slice(0, 700)
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const toc =
        /目\s*录/.test(lines.slice(0, 3).join("")) ||
        (text.match(/\.{4,}|(?:\.\s){5,}/g) || []).length > 3;
      let heading = lines
        .slice(0, 2)
        .find(
          (l) =>
            /^(?:第.{1,10}章.{2,}|chapter\s+\d+\s+\S)/i.test(l) &&
            l.length < 55 &&
            !/[。；，！？]/.test(l),
        );
      let chapter = 0;
      if (heading) {
        const label =
          heading.match(/^第(.{1,10})章/)?.[1].replace(/\s/g, "") ||
          heading.match(/^chapter\s+(\d+)/i)?.[1];
        chapter =
          Number(label) ||
          ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"].indexOf(
            label,
          ) + 1;
        if (!chapter)
          chapter = Number(lines[1]?.match(/^(\d+)\s*\.\s*1\D/)?.[1]) || 0;
        if (!chapter || chapter <= lastChapter) heading = undefined;
      }
      const path = items[0].path;
      // Repeated chapter running headers must not split every page.
      if (
        page === pages[0] ||
        path ||
        (!toc && heading && heading !== lastHeading)
      ) {
        starts.push({
          page,
          title:
            path ||
            (!toc && heading) ||
            (toc ? "目录与阅读说明" : "开篇与阅读说明"),
        });
        if (heading && !toc) {
          lastHeading = heading;
          lastChapter = chapter;
        }
      }
    }
    // Scan/OCR books without usable headings still expose addressable page bands.
    if (starts.length < 3 && pages.length > 24) {
      starts.length = 0;
      for (let i = 0; i < pages.length; i += 16) {
        const page = pages[i];
        starts.push({
          page,
          title: `第 ${page}–${pages[Math.min(i + 15, pages.length - 1)]} 页 · ${source.pages.get(page)[0].text.replace(/\s+/g, " ").slice(0, 38)}`,
        });
      }
    }
    starts.forEach((start, i) => {
      const endPage = (starts[i + 1]?.page ?? pages.at(-1) + 1) - 1;
      sections.push({
        id: `${source.id}@${start.page}`,
        sourceId: source.id,
        sourceTitle: source.title,
        title: start.title,
        startPage: start.page,
        endPage,
        excerpt: source.pages
          .get(start.page)
          .map((c) => c.text)
          .join(" ")
          .slice(0, 220),
      });
    });
  }
  const result = {
    key,
    sources: [...sources.values()].map((s) => ({
      id: s.id,
      title: s.title,
      pages: s.pages.size,
    })),
    sections,
    totalPages: [...sources.values()].reduce((n, s) => n + s.pages.size, 0),
    cacheHit: false,
  };
  cache.set(key, result);
  if (cache.size > 4) cache.delete(cache.keys().next().value);
  return result;
}
export function coverage(catalog, evidence) {
  const pages = new Set(evidence.map((c) => `${c.sourceId}:${c.page}`));
  const covered = catalog.sections.filter((s) =>
    evidence.some(
      (c) =>
        c.sourceId === s.sourceId &&
        c.page >= s.startPage &&
        c.page <= s.endPage,
    ),
  );
  return {
    indexedPages: catalog.totalPages,
    sampledPages: pages.size,
    totalSections: catalog.sections.length,
    sampledSections: covered.length,
    missingSections: catalog.sections
      .filter((s) => !covered.includes(s))
      .slice(0, 16)
      .map((s) => s.title),
    note: "索引覆盖与抽读覆盖分开统计；抽读过章节不等于精读全部页面。",
  };
}
