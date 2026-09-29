import { useId, useRef, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, GripVertical, Quote } from "lucide-react";
import type { Evidence, LearningAttempt, LearningObject } from "../types";
import { gradeQuestion, objectMarkdown } from "../learning-objects.mjs";
import { objectDefinition } from "../domain/objects.mjs";
import { questionView, type QuestionDraft } from "../question-state.mjs";
import AnswerMarkdown, { CopyButton } from "./AnswerMarkdown";
import { writeWorkspaceTransfer } from "../object-transfer.mjs";
import { writeQuestionTransfer } from "../question-references.mjs";
const resultLabels = {
  correct: "回答正确",
  incorrect: "需要再想一想",
  skipped: "已跳过",
  "needs-review": "简答已记录，待讨论",
  "self-correct": "自评：基本正确",
  "self-incorrect": "自评：需要补充",
  "hint-viewed": "已查看提示",
};
export function Plot({ object }: { object: LearningObject }) {
  const p = object.plot!;
  const points = p.series.flatMap((s) => s.points),
    xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys, 0),
    maxY = Math.max(...ys, 0);
  const x = (v: number) => 55 + ((v - minX) / (maxX - minX || 1)) * 490;
  const y = (v: number) => 260 - ((v - minY) / (maxY - minY || 1)) * 220;
  const colors = [
    "#365f47",
    "#4074a4",
    "#a76e36",
    "#865ba4",
    "#398c8c",
    "#b85b65",
  ];
  const ref = useRef<SVGSVGElement>(null);
  return (
    <figure className="object-plot">
      <svg
        ref={ref}
        viewBox="0 0 600 320"
        role="img"
        aria-label={`${object.title}，横轴${p.xLabel}，纵轴${p.yLabel}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="600" height="320" fill="white" />
        {[0, 1, 2, 3, 4].map((i) => {
          const v = minY + ((maxY - minY || 1) * i) / 4;
          return (
            <g key={i}>
              <line x1="55" x2="545" y1={y(v)} y2={y(v)} stroke="#e7ece8" />
              <text
                x="48"
                y={y(v) + 4}
                textAnchor="end"
                fontSize="11"
                fill="#60666d"
              >
                {Number(v.toPrecision(3))}
              </text>
            </g>
          );
        })}
        <path d="M55 35V260H550" fill="none" stroke="#8c9690" />
        <text x="300" y="306" textAnchor="middle" fontSize="13">
          {p.xLabel}
        </text>
        <text x="55" y="20" fontSize="12">
          {p.yLabel}
        </text>
        {[minX, (minX + maxX) / 2, maxX].map((v, i) => (
          <text key={i} x={x(v)} y="280" textAnchor="middle" fontSize="11">
            {Number(v.toPrecision(3))}
          </text>
        ))}
        {p.series.map((s, i) => (
          <g key={i} fill={colors[i]} stroke={colors[i]}>
            {p.type === "line" && (
              <polyline
                fill="none"
                strokeWidth="2"
                points={s.points.map(([a, b]) => `${x(a)},${y(b)}`).join(" ")}
              />
            )}
            {s.points.map(([a, b], j) =>
              p.type === "bar" ? (
                <rect
                  key={j}
                  x={x(a) - Math.min(18, 180 / s.points.length) / 2 + i * 4}
                  y={Math.min(y(0), y(b))}
                  width={Math.min(18, 180 / s.points.length)}
                  height={Math.max(1, Math.abs(y(b) - y(0)))}
                >
                  <title>{`${s.name}: (${a}, ${b})`}</title>
                </rect>
              ) : (
                <circle
                  key={j}
                  cx={x(a)}
                  cy={y(b)}
                  r={p.type === "scatter" ? 3 : 2}
                >
                  <title>{`${s.name}: (${a}, ${b})`}</title>
                </circle>
              ),
            )}
          </g>
        ))}
      </svg>
      <figcaption>
        {p.series.map((s, i) => (
          <span key={i} style={{ color: colors[i] }}>
            ● {s.name}
          </span>
        ))}
      </figcaption>
      <CopyButton label="复制 SVG" value={() => ref.current?.outerHTML || ""} />
      <details>
        <summary>查看数据</summary>
        <pre>
          {p.series
            .map(
              (s) =>
                s.name +
                "\nx, y\n" +
                s.points.map((v) => v.join(", ")).join("\n"),
            )
            .join("\n\n")}
        </pre>
      </details>
    </figure>
  );
}
export default function LearningObjectCard({
  object,
  evidence = [],
  onCitation,
  onOpen,
  attempts = [],
  onAttempt,
  expanded = false,
  drafts,
  onDraft,
  projectId,
  workspaceNodeId,
  onReferenceQuestion,
  onAskQuestion,
  embedded = false,
}: {
  object: LearningObject;
  evidence?: Evidence[];
  onCitation: (e: Evidence) => void;
  onOpen?: (o: LearningObject) => void;
  attempts?: LearningAttempt[];
  onAttempt?: (a: LearningAttempt) => void;
  expanded?: boolean;
  drafts?: Record<string, QuestionDraft>;
  onDraft?: (objectId: string, draft: QuestionDraft) => void;
  projectId?: string;
  workspaceNodeId?: string;
  onReferenceQuestion?: (object: LearningObject) => void;
  onAskQuestion?: (object: LearningObject) => void;
  embedded?: boolean;
}) {
  const questionGroupId = useId();
  const [localDrafts, setLocalDrafts] = useState<Record<string, QuestionDraft>>(
    {},
  );
  const [step, setStep] = useState(0);
  const q = object.question;
  const missingAnswer = q?.answerStatus === "missing";
  const state = q
    ? questionView(object.id, q, attempts, drafts || localDrafts)
    : undefined;
  const answer = state?.answer || "";
  const hint = state?.hint || false;
  const result = state?.result;
  const skipped = result?.result === "skipped";
  const submitted = result && !skipped ? result : undefined;
  function updateDraft(patch: Partial<QuestionDraft>) {
    if (!state) return;
    const draft = {
      revision: state.revision,
      answer: state.answer,
      hint: state.hint,
      retry: state.retry,
      ...patch,
    };
    setLocalDrafts((current) => ({ ...current, [object.id]: draft }));
    onDraft?.(object.id, draft);
  }
  const record = (action = "submit") => {
    if (!q || !onAttempt) return;
    const grade = gradeQuestion(q, answer, action);
    if (grade === "unanswered") return;
    onAttempt({
      id: crypto.randomUUID(),
      objectId: object.id,
      prompt: q.prompt,
      answer:
        action === "skip"
          ? ""
          : q.type === "short"
            ? answer
            : q.options[Number(answer)] || "",
      result: grade,
      assisted: state?.assisted || false,
      questionRevision: state?.revision,
      answerValue: answer,
      feedback: action === "skip" ? "" : missingAnswer ? "本题暂未附参考答案，作答已记录，待核对。" : q.explanation,
      at: new Date().toISOString(),
    });
    updateDraft({ retry: false });
  };
  const definition = objectDefinition(object.kind);
  const displayTitle = q && object.title.trim() === q.prompt.trim()
    ? q.type === "short" ? "简答题" : q.type === "boolean" ? "判断题" : "选择题"
    : object.title;
  const content = objectMarkdown(object);
  const draggable = Boolean(projectId);
  const titleProps = {
    draggable,
    title: draggable ? onOpen ? "点击或拖出卡片" : "拖出卡片" : onOpen ? "展开卡片" : undefined,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (!projectId) return;
      event.stopPropagation();
      writeWorkspaceTransfer(event.dataTransfer, projectId, workspaceNodeId || object.id, object.title, "object");
      if (q) writeQuestionTransfer(event.dataTransfer, projectId, object.id);
    },
  };
  return (
    <section
      className={`learning-object ${expanded ? "expanded" : ""} ${embedded ? "is-embedded" : ""}`}
      aria-label={`${definition.label}：${object.title}`}
    >
      {!embedded && <header>
        {!q && <span>{definition.label}</span>}
        {onOpen ? <button {...titleProps} className="learning-object-title" type="button" onClick={() => onOpen(object)} aria-label={`展开卡片：${object.title}`}>
          <span>{displayTitle}</span>{draggable && <GripVertical className="object-drag-handle" size={14} aria-hidden="true"/>}
        </button> : <strong {...titleProps} className="learning-object-title"><span>{displayTitle}</span>{draggable && <GripVertical className="object-drag-handle" size={14} aria-hidden="true"/>}</strong>}
      </header>}
      {q ? (
        <div className="learning-question">
          {(q.sourceQuestionNumber || q.anchors?.length) && (
            <div className="object-actions">
              {q.sourceQuestionNumber && <span>原题 {q.sourceQuestionNumber}</span>}
              {q.anchors?.map((anchor, index) => (
                <button
                  key={`${anchor.sourceId}:${anchor.page}:${index}`}
                  type="button"
                  className="button small"
                  aria-label={`查看题目原文：${anchor.title}，第 ${anchor.page} 页`}
                  onClick={() => onCitation({
                    id: `question-origin:${object.id}:${anchor.sourceId}:${anchor.page}`,
                    sourceId: anchor.sourceId,
                    page: anchor.page,
                    title: anchor.title,
                    text: anchor.quote || "",
                  })}
                >
                  原文 · 第 {anchor.page} 页
                </button>
              ))}
            </div>
          )}
          <AnswerMarkdown
            showCopy={false}
            content={q.prompt}
            evidence={evidence}
            onCitation={onCitation}
          />
          {skipped && <p className="question-deferred" role="status">已暂时跳过，可以稍后继续作答。</p>}
          {!submitted &&
            (q.type === "short" ? (
              <textarea
                aria-label={`作答：${object.title}`}
                rows={3}
                value={answer}
                onChange={(e) => updateDraft({ answer: e.target.value })}
                placeholder="写下你的推理…"
              />
            ) : (
              <fieldset>
                <legend className="sr-only">选择答案</legend>
                {q.options.map((option, i) => (
                  <label key={i}>
                    <input
                      type="radio"
                      name={questionGroupId}
                      value={i}
                      checked={answer === String(i)}
                      onChange={() => updateDraft({ answer: String(i) })}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          {submitted ? (
            <div className="object-feedback" role="status">
              <strong>{missingAnswer ? "作答已记录，待核对" : resultLabels[submitted.result]}</strong>
              <p>
                你的回答：{submitted.answer || "未作答"}
                {submitted.assisted ? " · 已参考提示或解析" : ""}
              </p>
              {missingAnswer ? (
                <p>本题暂未附参考答案。作答已记录，待核对；可回原对话请 Tutor 核对。</p>
              ) : <AnswerMarkdown
                content={`参考答案：${q.type === "short" ? q.answer : q.options[Number(q.answer)]}\n\n${q.explanation}`}
                evidence={evidence}
                onCitation={onCitation}
              />}
              {submitted.result === "needs-review" && !missingAnswer && (
                <div className="object-actions">
                  {[
                    ["self-correct", "基本正确"],
                    ["self-incorrect", "需要补充"],
                  ].map(([r, label]) => (
                    <button
                      key={r}
                      className="button small"
                      onClick={() =>
                        onAttempt?.({
                          ...submitted,
                          id: crypto.randomUUID(),
                          result: r as LearningAttempt["result"],
                          at: new Date().toISOString(),
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button
                className="button small"
                onClick={() => {
                  updateDraft({ retry: true, answer: "", hint: false });
                }}
              >
                再做一次
              </button>
            </div>
          ) : (
            <>
              <div className="object-actions">
                <button
                  className="button primary small"
                  disabled={!answer.trim()}
                  onClick={() => record()}
                >
                  提交答案
                </button>
                {q.hint && (
                  <button
                    className="button small"
                    onClick={() => {
                      updateDraft({ hint: true });
                      if (!hint)
                        onAttempt?.({
                          id: crypto.randomUUID(),
                          objectId: object.id,
                          prompt: q.prompt,
                          answer: "",
                          result: "hint-viewed",
                          assisted: true,
                          questionRevision: state?.revision,
                          answerValue: answer,
                          feedback: q.hint || "",
                          at: new Date().toISOString(),
                        });
                    }}
                  >
                    提示一点
                  </button>
                )}
                {!skipped && <button className="text-button" onClick={() => record("skip")}>
                  暂时跳过
                </button>}
              </div>
              {hint && <p className="object-hint">{q.hint}</p>}
            </>
          )}
          {(onAskQuestion || onReferenceQuestion) && <button {...titleProps} type="button" className="text-button question-ask"
            title={onAskQuestion ? "打开这道题的对话，问题由你发送" : "把这道题和作答带入对话，问题由你发送"} aria-label={`问问这题：${object.title}`} onClick={() => (onAskQuestion || onReferenceQuestion)?.(object)}><Quote size={14} aria-hidden="true"/>问问这题</button>}
          <small>
            {missingAnswer
              ? "未附参考答案，作答后请核对原文。"
              : q.type === "short" ? "简答由你自评，可继续向 Tutor 追问。" : "作答会随下一次提问带给 Tutor。"}
          </small>
        </div>
      ) : object.plot ? (
        <>
          <Plot object={object} />
          {object.content && (
            <AnswerMarkdown content={object.content} onCitation={onCitation} />
          )}
        </>
      ) : object.steps ? (
        <div className="object-trace">
          <div className="object-actions">
            <button
              aria-label="上一步"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {step + 1} / {object.steps.length} · {object.steps[step].title}
            </span>
            <button
              aria-label="下一步"
              disabled={step === object.steps.length - 1}
              onClick={() => setStep(step + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <AnswerMarkdown
            content={object.steps[step].content}
            onCitation={onCitation}
          />
        </div>
      ) : (
        <AnswerMarkdown
          showCopy={definition.renderer !== "code"}
          content={content}
          evidence={evidence}
          onCitation={onCitation}
        />
      )}
    </section>
  );
}
