import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check } from "lucide-react";
import { remarkEvidence } from "../markdown-evidence.mjs";
import type { Evidence } from "../types";
import EvidenceCitation from "./EvidenceCitation";
import "katex/dist/katex.min.css";

export function CopyButton({
  value,
  label = "复制回答",
}: {
  value: string | (() => string);
  label?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <button
      type="button"
      className="answer-copy"
      aria-label={status || label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(
            typeof value === "function" ? value() : value,
          );
          setStatus("已复制");
        } catch {
          setStatus("复制失败，请选择文字复制");
        }
      }}
    >
      {status === "已复制" ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      <span aria-live="polite">{status || label}</span>
    </button>
  );
}
function CodeBlock({
  children,
  language,
}: {
  children: ReactNode;
  language: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <figure className="answer-code">
      <figcaption>
        <span>{language || "代码"}</span>
        <CopyButton
          label="复制代码"
          value={() => ref.current?.textContent || ""}
        />
      </figcaption>
      <pre ref={ref} tabIndex={0} aria-label={`${language || "代码"}代码块`}>
        {children}
      </pre>
    </figure>
  );
}
const AnswerMarkdown = memo(function AnswerMarkdown({
  content,
  evidence = [],
  onCitation,
  showCopy = true,
}: {
  content: string;
  evidence?: Evidence[];
  onCitation: (e: Evidence) => void;
  showCopy?: boolean;
}) {
  return (
    <div className="answer-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[
          remarkGfm,
          remarkMath,
          [remarkEvidence, { count: evidence.length }],
        ]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              trust: false,
              strict: "ignore",
              throwOnError: false,
              maxExpand: 100,
              maxSize: 20,
            },
          ],
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={{
          span: ({ node: _node, className, children, ...props }) =>
            className?.includes("katex-display") ? (
              <span
                {...props}
                className={className}
                tabIndex={0}
                role="region"
                aria-label="公式，可横向滚动"
              >
                {children}
              </span>
            ) : (
              <span {...props} className={className}>
                {children}
              </span>
            ),
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          a: ({ href, children }) => {
            const citation = href?.match(/^#source-(\d+)$/);
            const item = citation && evidence[Number(citation[1]) - 1];
            if (item)
              return (
                <EvidenceCitation
                  evidence={item}
                  onOpen={onCitation}
                  className="inline-citation"
                  label={`预览来源 ${citation![1]}：${item.title}，第 ${item.page} 页`}
                >
                  {citation![1]}
                </EvidenceCitation>
              );
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          pre: ({ node, children }) => {
            const code = node?.children.find(
              (c) => c.type === "element" && c.tagName === "code",
            );
            const names =
              code?.type === "element"
                ? String(code.properties.className || "")
                : "";
            const language = names.match(/language-([\w+-]+)/)?.[1] || "";
            return <CodeBlock language={language}>{children}</CodeBlock>;
          },
          table: ({ children }) => (
            <div
              className="answer-table"
              tabIndex={0}
              role="region"
              aria-label="对比表，可横向滚动"
            >
              <table>{children}</table>
            </div>
          ),
          img: ({ alt }) => (
            <span className="answer-image-note">
              [图片：{alt || "请查看原始来源"}]
            </span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {showCopy && <CopyButton value={content} />}
    </div>
  );
});
export default AnswerMarkdown;
