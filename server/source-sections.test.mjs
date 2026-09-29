import test from "node:test";
import assert from "node:assert/strict";
import { sourceSections, normalizeSourceSections, readPdfOutlineSections } from "../src/source-sections.mjs";

const source = (pages, extra = {}) => ({ id: "book", kind: "pdf", pages, chunks: [], ...extra });

test("chapter and section ranges use physical page indices and retain hierarchy", () => {
  const sections = sourceSections(source(["封面", "说明", "第 1 章 绪论\n1.1 学习问题", "正文", "1 . 2 归纳偏好", "第 2 章 评估\n2.1 误差", "正文"]));
  const chapter = sections.find((item) => item.title === "第 1 章 绪论");
  const subsection = sections.find((item) => item.title === "1.2 归纳偏好");
  assert.equal(chapter.page, 3);
  assert.equal(chapter.endPage, 5);
  assert.equal(subsection.page, 5);
  assert.equal(subsection.parentId, chapter.id);
  assert.equal(sections[0].kind, "pages");
});

test("contents and repeated OCR running headers do not invent chapter starts", () => {
  const sections = sourceSections(source(["目录\n第1章 绪论 ...... 1\n第2章 评估 ...... 20", "6 第 1 章 绪论\n正文", "第 1 章 绪论\n正文", "第 1 章 绪论\n正文", "1 . 3 假设空间 5\n正文"]));
  assert.deepEqual(sections.map((item) => [item.kind, item.page, item.endPage]), [["pages", 1, 5]]);
});

test("a first encountered numbered running header is not a chapter boundary", () => {
  const sections = sourceSections(source(["封面", "6 第 1 章 绪论\n正文", "正文"]));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, "pages");
});

test("explicit chapter headings survive repeated running headers without duplication", () => {
  const sections = sourceSections(source(["# 第 1 章 绪论", "第 1 章 绪论\n正文", "# 第 1 章 绪论\n正文"]));
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, "chapter");
  assert.equal(sections[0].page, 1);
  assert.equal(sections[0].endPage, 3);
});

test("no reliable headings yields explicit 16-page bands", () => {
  const sections = sourceSections(source(Array.from({ length: 35 }, () => "普通段落。")));
  assert.deepEqual(sections.map((item) => [item.kind, item.page, item.endPage]), [["pages", 1, 16], ["pages", 17, 32], ["pages", 33, 35]]);
});

test("Markdown titles retain levels and source outline has priority", () => {
  const pages = ["# Introduction\n## Learning", "### Hypotheses", "# Evaluation"];
  const fallback = sourceSections(source(pages));
  assert.equal(fallback[2].parentId, fallback[1].id);
  const outline = [{ title: "Actual outline", page: 1, level: 1 }, { title: "Nested", page: 2, level: 2 }];
  const preferred = sourceSections(source(pages, { outline }));
  assert.equal(preferred[0].title, "Actual outline");
  assert.equal(preferred[0].id, fallback[0].id);
  assert.equal(preferred[1].parentId, preferred[0].id);
});

test("GitHub groups chunk paths once using valid physical pages", () => {
  const sections = sourceSections(source(["one", "two", "three"], { kind: "github", chunks: [
    { path: "docs/guide.md", page: 3 }, { path: "README.md", page: 1 },
    { path: "README.md", page: 1 }, { path: "README.md", page: 2 }, { path: "invalid.md", page: 9 },
  ] }));
  assert.deepEqual(sections.map((item) => [item.title, item.kind, item.page, item.endPage]), [["README.md", "document", 1, 2], ["docs/guide.md", "document", 3, 3]]);
});

test("source progress changes reuse cached arrays and outline replacement invalidates", () => {
  const original = source(["# One", "body"]);
  const sections = sourceSections(original);
  assert.equal(sourceSections({ ...original, progress: 2 }), sections);
  assert.notEqual(sourceSections({ ...original, outline: [{ title: "Outline", page: 1, level: 1 }] }), sections);
});

test("invalid outline destinations are excluded and same-page nodes have stable unique IDs", () => {
  const sections = normalizeSourceSections("pdf", [{ title: "Chapter", page: 2, level: 1 }, { title: "A", page: 2, level: 2 }, { title: "B", page: 2, level: 2 }, { title: "Bad", page: 0, level: 1 }], 4);
  assert.equal(new Set(sections.map((item) => item.id)).size, 3);
  assert.equal(sections[1].parentId, sections[0].id);
  assert.equal(sections[1].endPage, 2);
  assert.equal(sections[2].endPage, 4);
});

test("PDF outline resolves named and object destinations into physical pages", async () => {
  const pdf = {
    numPages: 20,
    getOutline: async () => [
      { title: "Introduction", dest: "intro", items: [{ title: "Nested", dest: [{ num: 4, gen: 0 }], items: [] }] },
      { title: "External", dest: null, items: [] },
      { title: "Evaluation", dest: [9], items: [] },
      { title: "Out of range", dest: [30], items: [] },
    ],
    getDestination: async (name) => name === "intro" ? [2] : null,
    getPageIndex: async (ref) => ref.num === 4 ? 4 : -1,
  };
  const sections = await readPdfOutlineSections(pdf, "book");
  assert.deepEqual(sections.map((item) => [item.title, item.page, item.endPage]), [["Introduction", 3, 9], ["Nested", 5, 9], ["Evaluation", 10, 20]]);
  assert.equal(sections[1].parentId, sections[0].id);
  assert.deepEqual(await readPdfOutlineSections({ ...pdf, getOutline: async () => null }, "book"), []);
  assert.deepEqual(await readPdfOutlineSections(pdf, "book", 20, () => false), []);
});
