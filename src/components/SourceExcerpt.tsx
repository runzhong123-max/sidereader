import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { prepareSourceExcerpt } from "../source-excerpt.mjs";
import type { OriginalFormula } from "../services/pdf-excerpt";
import "katex/dist/katex.min.css";
import "../source-excerpt.css";

type TextTree = { type: string; value?: string; children?: TextTree[]; data?: unknown };

// Highlight only literal prose, never TeX, URLs or HTML supplied by a document.
function remarkSourceHit({ query }: { query: string }) {
  const needle = query.trim().toLocaleLowerCase();
  return (tree: TextTree) => {
    if (!needle) return;
    function visit(node: TextTree) {
      if (!node.children || ["code", "inlineCode", "math", "inlineMath", "html"].includes(node.type)) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const result: TextTree[] = [];
        const text = child.value;
        const lower = text.toLocaleLowerCase();
        let start = 0;
        let index = lower.indexOf(needle);
        while (index !== -1) {
          if (index > start) result.push({ type: "text", value: text.slice(start, index) });
          result.push({ type: "strong", data: { hName: "mark" }, children: [{ type: "text", value: text.slice(index, index + needle.length) }] });
          start = index + needle.length;
          index = lower.indexOf(needle, start);
        }
        if (start < text.length) result.push({ type: "text", value: text.slice(start) });
        return result;
      });
    }
    visit(tree);
  };
}

// Phrasing-only markup also works inside a search-result button. A source
// excerpt has no nested actions, remote images, or document-provided links.
const components: Components = {
  p: ({ children }) => <span className="source-paragraph">{children}</span>,
  h1: ({ children }) => <strong className="source-heading">{children}</strong>,
  h2: ({ children }) => <strong className="source-heading">{children}</strong>,
  h3: ({ children }) => <strong className="source-heading">{children}</strong>,
  h4: ({ children }) => <strong className="source-heading">{children}</strong>,
  h5: ({ children }) => <strong className="source-heading">{children}</strong>,
  h6: ({ children }) => <strong className="source-heading">{children}</strong>,
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => <span className="source-image-note">〔{alt || "图片见原页"}〕</span>,
  blockquote: ({ children }) => <span className="source-quote">{children}</span>,
  ul: ({ children }) => <span className="source-list">{children}</span>,
  ol: ({ children }) => <span className="source-list source-list-ordered">{children}</span>,
  li: ({ children }) => <span className="source-list-item">{children}</span>,
  pre: ({ children }) => <span className="source-code-block">{children}</span>,
  table: ({ children }) => <span className="source-table">{children}</span>,
  thead: ({ children }) => <span className="source-table-head">{children}</span>,
  tbody: ({ children }) => <span className="source-table-body">{children}</span>,
  tr: ({ children }) => <span className="source-table-row">{children}</span>,
  th: ({ children }) => <strong className="source-table-cell">{children}</strong>,
  td: ({ children }) => <span className="source-table-cell">{children}</span>,
  hr: () => <span className="source-rule" />,
  input: ({ checked }) => <span>{checked ? "☑" : "☐"}</span>,
};

/** Display-only preparation: the stored source and citation anchor stay intact. */
const SourceExcerpt = memo(function SourceExcerpt({ text, query = "", compact = true, formulae = [] }: {
  text: string;
  query?: string;
  compact?: boolean;
  formulae?: OriginalFormula[];
}) {
  const originalLabel = (label: string) => {
    const matches = [...text.matchAll(/[（(]\s*(?:[A-Za-z]\s*[.\-]\s*)?\d+(?:\s*[.\-]\s*\d+)*\s*[)）]/g)]
      .filter(match => match[0].replace(/\s/g, "").replace("（", "(").replace("）", ")") === label);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const restored = useMemo(() => {
    let result = text;
    const edits = formulae.flatMap((formula, index) => {
      const label = originalLabel(formula.label);
      const start = formula.start ?? label?.index;
      const end = formula.end ?? (label ? label.index! + label[0].length : undefined);
      if (start === undefined || end === undefined) return [];
      const changes = [{ start, end, value: `\n\n![原页公式 ${formula.label}](#source-formula-${index})\n\n` }];
      // Some PDFs store all equation numbers before their bodies. Remove only
      // that exact number when the body itself was matched independently.
      if (label && (label.index! >= end || label.index! + label[0].length <= start))
        changes.push({ start: label.index!, end: label.index! + label[0].length, value: "" });
      return changes;
    }).sort((a, b) => b.start - a.start);
    for (const edit of edits) {
      result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    }
    return result;
  }, [text, formulae]);
  const hit = query ? text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) : -1;
  const contextMatches = (formula: OriginalFormula) => Boolean(query.trim() && formula.context?.replace(/\s/g, "").toLocaleLowerCase().includes(query.replace(/\s/g, "").toLocaleLowerCase()));
  const chosenFormula = useMemo(() => {
    if (!query) return formulae[0];
    if (hit < 0) return undefined;
    const nearest = formulae.map(formula => ({ formula, distance: Math.abs((formula.start ?? originalLabel(formula.label)?.index ?? Infinity) - hit) }))
      .sort((a, b) => Number(contextMatches(b.formula)) - Number(contextMatches(a.formula)) || a.distance - b.distance)[0];
    return nearest && (contextMatches(nearest.formula) || nearest.distance <= 350) ? nearest.formula : undefined;
  }, [formulae, text, query, hit]);
  const illustrated = compact && Boolean(chosenFormula);
  const excerpt = useMemo(() => {
    if (illustrated) {
      const first = chosenFormula!;
      const before = text.slice(0, first.start ?? originalLabel(first.label)?.index ?? 0);
      return prepareSourceExcerpt(query && !contextMatches(first) ? text : first.context || before, { query, maxChars: 100 });
    }
    return prepareSourceExcerpt(restored, { query, maxChars: compact ? 160 : undefined });
  }, [text, restored, query, compact, illustrated, chosenFormula]);
  const note = excerpt.hasUncertainText ? <span className="source-excerpt-note">部分字符或公式需核对原页</span> : null;
  const formulaImage = (formula: OriginalFormula) => <img className="source-original-formula" src={formula.image}
    alt={`原页公式 ${formula.label}`} title={`公式 ${formula.label} · 本地 PDF 原页`}
    style={{ width: Math.min(440, formula.width * 1.05), aspectRatio: `${formula.width} / ${formula.height}` }} />;
  return <span className={`source-excerpt${compact ? " source-excerpt-compact" : ""}${illustrated ? " source-excerpt-illustrated" : ""}`}>
    {!compact && note}
    <span className="source-excerpt-body">
      <ReactMarkdown skipHtml components={{ ...components, img: ({ src, alt }) => {
        const match = src?.match(/^#source-formula-(\d+)$/);
        const formula = match && formulae[Number(match[1])];
        return formula ? formulaImage(formula) : <span className="source-image-note">〔{alt || "图片见原页"}〕</span>;
      } }}
        remarkPlugins={[remarkGfm, remarkMath, [remarkSourceHit, { query }]]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore", throwOnError: false, maxExpand: 100, maxSize: 10 }]]}>
        {excerpt.markdown || "暂无文字摘录，可查看原页。"}
      </ReactMarkdown>
    </span>
    {illustrated && chosenFormula && <span className="source-original-equation">{formulaImage(chosenFormula)}</span>}
  </span>;
});

export default SourceExcerpt;
