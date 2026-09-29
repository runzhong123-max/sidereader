import type { Message, ReadingAnchor } from "../types";
export default function ResearchResult({
  message,
  onApply,
  onUndo,
  onRead,
  onOpenProjectObject,
}: {
  message: Message;
  onApply?: () => void;
  onUndo?: () => void;
  onRead?: (anchor: ReadingAnchor) => void;
  onOpenProjectObject?: (kind: "graph" | "path") => void;
}) {
  const r = message.research,
    p = message.proposal;
  const proposalKinds = p
    ? [p.concepts.length > 0 && "图谱", p.stages.length > 0 && "关卡图"].filter(Boolean).join("与")
    : "";
  return (
    <div className="research-result">
      {r && (
        <details className="research-audit">
          <summary>
            {r.mode === "deep" ? "深度研究" : "资料核对"} · 抽读{" "}
            {r.coverage.sampledSections}/{r.coverage.totalSections} 个目录项 ·{" "}
            {r.coverage.sampledPages} 页
          </summary>
          <p>
            已索引 {r.coverage.indexedPages} 页；抽读范围不等于全文精读。
            {r.stopReason !== "sufficient" && "本次按预算或工具结果收束。"}
          </p>
          <ol>
            {r.trace.map((t, i) => (
              <li key={i}>
                {t.summary}
                {t.count ? ` · ${t.count} 项` : ""}
              </li>
            ))}
          </ol>
          {r.gaps.length > 0 && <p>待补：{r.gaps.join("；")}</p>}
          <small>
            {r.metrics.calls} 次模型调用 · {(r.elapsedMs / 1000).toFixed(1)} 秒
            {r.metrics.usageReported
              ? ` · 输入 ${r.metrics.inputTokens.toLocaleString()} / 输出 ${r.metrics.outputTokens.toLocaleString()} tokens`
              : " · 服务未返回 token 用量"}
          </small>
        </details>
      )}
      {p && (p.concepts.length > 0 || p.stages.length > 0) && (
        <section className="project-proposal">
          <header>
            <strong>学习对象更新</strong>
            <div className="proposal-actions">
              {message.proposalApplied && (
                <span className="proposal-applied">已更新学习对象</span>
              )}
              {message.proposalApplied && message.proposalUndo && onUndo ? (
                <button className="button small" onClick={onUndo}>
                  撤回此次更新
                </button>
              ) : (
                !message.proposalApplied && (
                  <button
                    className="button small primary"
                    disabled={!onApply}
                    onClick={onApply}
                  >
                    {message.proposalReverted ? "重新应用更新" : `更新${proposalKinds}`}
                  </button>
                )
              )}
            </div>
          </header>
          <p>
            {p.concepts.length} 个概念 · {p.stages.length}{" "}
            个学习步骤。更新对应学习对象，保留已有布局和完成记录。
          </p>
          {message.proposalReverted && (
            <p className="proposal-reverted" role="status">
              已撤回此次更新。
              {message.proposalReverted.retained > 0
                ? `保留了 ${message.proposalReverted.retained} 个对象的后续修改或引用。`
                : "后续学习记录不受影响。"}
            </p>
          )}
          {(message.proposalApplied || message.proposalReverted) &&
            onOpenProjectObject && (
              <div
                className="proposal-destinations"
                aria-label="查看更新的对象卡片"
              >
                {p.concepts.length > 0 && (
                  <button onClick={() => onOpenProjectObject("graph")}>
                    知识图谱卡片 <span aria-hidden="true">↗</span>
                  </button>
                )}
                {p.stages.length > 0 && (
                  <button onClick={() => onOpenProjectObject("path")}>
                    关卡图卡片 <span aria-hidden="true">↗</span>
                  </button>
                )}
              </div>
            )}
          <details>
            <summary>查看更新内容与阅读位置</summary>
            <div className="proposal-concepts">
              {p.concepts.map((c) => (
                <span key={c.id}>{c.name}</span>
              ))}
            </div>
            {p.stages.map((s) => (
              <article key={s.id}>
                <strong>{s.title}</strong>
                <p>{s.description}</p>
                <p>产物：{s.deliverable}</p>
                <p>验收：{s.check}</p>
                {s.anchors?.map((a, i) => (
                  <button
                    className="button small"
                    key={i}
                    onClick={() => onRead?.(a)}
                  >
                    {a.title} · 第 {a.page} 页 ↗
                  </button>
                ))}
              </article>
            ))}
          </details>
          {p.warnings.length > 0 && <p>{p.warnings.join(" ")}</p>}
        </section>
      )}
    </div>
  );
}
