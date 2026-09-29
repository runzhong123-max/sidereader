import { useState } from "react";
import {
  Plus,
  ArrowLeft,
  ArrowRight,
  Check,
  Pencil,
  Trash2,
  FileQuestion,
  RotateCcw,
  MoreHorizontal,
} from "lucide-react";
import type {
  Question,
  QuestionSet,
  LearningAttempt,
  LearningObject,
  ReadingAnchor,
  Evidence,
} from "../types";
import {
  practiceSummary,
  questionObject,
  questionRevision,
  questionView,
  type QuestionDraft,
} from "../question-state.mjs";
import LearningObjectCard from "./LearningObjectCard";
import ObjectContext from "./ObjectContext";
import ActionMenu from "./ActionMenu";
import "../practice-student.css";
import { questionOriginLabel } from "../object-provenance.mjs";
const labels = { choice: "选择题", boolean: "判断题", short: "简答题" };
export default function Questions({
  projectId,
  sets,
  onChange,
  initialSetId,
  onOverview,
  onReadAnchor,
  onOrigin,
  onAttempt,
  attempts,
  onReferenceQuestion,
  onAskQuestion,
  drafts = {},
  onDraft,
  positions = {},
  onPosition,
  hideTitle = false,
  scopeLabel,
}: {
  projectId: string;
  sets: QuestionSet[];
  onChange: (sets: QuestionSet[]) => void;
  initialSetId?: string;
  onOverview?: () => void;
  onReadAnchor?: (anchor: ReadingAnchor) => void;
  onOrigin?: (set: QuestionSet) => void;
  onAttempt: (a: LearningAttempt) => void;
  attempts: LearningAttempt[];
  onOpenObject: (o: LearningObject) => void;
  onReferenceQuestion?: (object: LearningObject) => void;
  onAskQuestion?: (object: LearningObject) => void;
  drafts?: Record<string, QuestionDraft>;
  onDraft: (objectId: string, draft: QuestionDraft) => void;
  positions?: Record<string, string>;
  onPosition: (setId: string, questionId: string) => void;
  hideTitle?: boolean;
  scopeLabel?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(initialSetId || null);
  const [edit, setEdit] = useState(
    Boolean(
      initialSetId &&
      sets.find((s) => s.id === initialSetId)?.questions.length === 0,
    ),
  );
  const [questionId, setQuestionId] = useState(
    initialSetId ? positions[initialSetId] || "" : "",
  );
  const active = sets.find((s) => s.id === activeId);
  const index = Math.max(
    0,
    active?.questions.findIndex((q) => q.id === questionId) ?? 0,
  );
  const q = active?.questions[index];
  const object = active && q ? questionObject(active.id, q) : undefined;
  function goTo(setId: string, id: string) {
    setQuestionId(id);
    onPosition(setId, id);
  }
  function open(id: string, editing = false) {
    setActiveId(id);
    setEdit(editing);
    setQuestionId(positions[id] || "");
  }
  function restart(set: QuestionSet) {
    for (const question of set.questions) {
      onDraft(questionObject(set.id, question).id, {
        revision: questionRevision(question),
        answer: "",
        retry: true,
        hint: false,
      });
    }
    goTo(set.id, set.questions[0]?.id || "");
  }
  function update(set: QuestionSet) {
    onChange(sets.map((s) => (s.id === set.id ? set : s)));
  }
  function patchQuestion(patch: Partial<Question>) {
    if (Object.hasOwn(patch, "answer")) patch.answerStatus = patch.answer?.trim() ? "provided" : "missing";
    if (active && q)
      update({
        ...active,
        lastScore: undefined,
        questions: active.questions.map((item) =>
          item.id === q.id ? { ...q, ...patch } : item,
        ),
      });
  }
  function addQuestion() {
    if (!active) return;
    const question: Question = {
      id: crypto.randomUUID(),
      type: "choice",
      prompt: "",
      options: ["", "", "", ""],
      answer: "0",
      explanation: "",
    };
    update({
      ...active,
      lastScore: undefined,
      questions: [...active.questions, question],
    });
    goTo(active.id, question.id);
  }
  if (!active)
    return (
      <div className="page">
        <div className="page-heading">
          <div>
            <h1>练习文件</h1>
            <p>保存问题，继续练习并回看作答记录。</p>
          </div>
          <button
            className="button primary"
            onClick={() => {
              const id = crypto.randomUUID();
              onChange([
                ...sets,
                {
                  id,
                  title: "新的练习文件",
                  description: "为这次学习设计一组问题",
                  origin: "manual",
                  questions: [],
                },
              ]);
              open(id, true);
            }}
          >
            <Plus size={16} />
            新建练习文件
          </button>
        </div>
        <div className="question-set-grid">
          {sets.map((set) => (
            <article className="question-set" key={set.id}>
              <div className="set-icon">
                <FileQuestion size={27} strokeWidth={1.4} />
              </div>
              <div className="set-meta">
                {questionOriginLabel(set)} <span>·</span> {set.questions.length} 道题
              </div>
              <h2>{set.title}</h2>
              <p>{set.description}</p>
              <div className="question-type-tags">
                {Object.entries(labels)
                  .filter(([key]) => set.questions.some((q) => q.type === key))
                  .map(([key, label]) => (
                    <span key={key}>{label}</span>
                  ))}
              </div>
              <small className="last-score">
                已提交 {practiceSummary(set, attempts, drafts).submitted} /{" "}
                {set.questions.length} 道
              </small>
              <footer>
                <button
                  className="text-button"
                  disabled={!set.questions.length}
                  onClick={() => open(set.id)}
                >
                  打开练习
                  <ArrowRight size={15} />
                </button>
                <div className="flex">
                  <button
                    className="icon-button"
                    aria-label={`编辑${set.title}`}
                    onClick={() => open(set.id, true)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`删除${set.title}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除练习文件「${set.title}」及其中 ${set.questions.length} 道题？此操作无法撤销，已有对象与作答历史会保留。`,
                        )
                      )
                        onChange(sets.filter((s) => s.id !== set.id));
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      </div>
    );
  const summary = practiceSummary(active, attempts, drafts);
  const multiple = active.questions.length > 1;
  const context = <div className="practice-file-meta">
    <ObjectContext label={questionOriginLabel(active)} scope={scopeLabel}
      onOrigin={active.sourceMessageId && onOrigin ? () => onOrigin(active) : undefined}/>
    {active.anchors?.map((anchor) => <button key={`${anchor.sourceId}:${anchor.page}`} className="text-button" onClick={() => onReadAnchor?.(anchor)} disabled={!onReadAnchor}>{anchor.title} · 第 {anchor.page} 页</button>)}
  </div>;
  return (
    <div className="page practice-page">
      {(onOverview || !initialSetId) && <button className="text-button muted" onClick={() => onOverview ? onOverview() : setActiveId(null)}>
        <ArrowLeft size={15} />
        返回练习
      </button>}
      <div className="practice-heading">
        {edit ? (
          <input
            className="title-input"
            aria-label="练习文件名称"
            value={active.title}
            onChange={(e) => update({ ...active, title: e.target.value })}
          />
        ) : (
          <h1 className={hideTitle ? "sr-only" : undefined}>{active.title}</h1>
        )}
        {hideTitle && !edit && context}
        {edit ? <button className="button" onClick={() => setEdit(false)}><Check size={15}/>完成编辑</button>
          : <ActionMenu label="练习操作" trigger={<MoreHorizontal size={17}/>}>
            <button onClick={() => setEdit(true)}><Pencil size={15}/>编辑题目</button>
            {summary.submitted > 0 && <button onClick={() => restart(active)}><RotateCcw size={15}/>重新练习</button>}
          </ActionMenu>}
      </div>
      {(!hideTitle || edit) && context}
      {!edit && multiple && active.description && <p className="muted">{active.description}</p>}
      {edit && <p className="muted">在这里手工编辑题目；也可以返回练习，在“新练习”中让 Tutor 出题或整理教材习题。</p>}
      {edit && (
        <input
          className="description-input"
          aria-label="练习文件说明"
          value={active.description}
          onChange={(e) => update({ ...active, description: e.target.value })}
        />
      )}
      {edit && <div className="practice-progress" role="group" aria-label="编辑题目导航">
        {active.questions.map((item, i) => {
          const result = questionView(
            questionObject(active.id, item).id,
            item,
            attempts,
            drafts,
          ).result;
          return (
            <button
              key={item.id}
              className={`${index === i ? "current" : ""} ${result && result.result !== "skipped" ? "answered" : ""}`}
              aria-label={`第${i + 1}题`}
              aria-current={index === i ? "step" : undefined}
              title={`第 ${i + 1} 题 · ${result ? result.result === "skipped" ? "已跳过" : "已作答" : "未作答"}`}
              onClick={() => goTo(active.id, item.id)}
            >
              {i + 1}
            </button>
          );
        })}
        {edit && (
          <button aria-label="添加题目" onClick={addQuestion}>
            <Plus size={17} />
          </button>
        )}
      </div>}
      {q && object ? (
        <div className="question-workspace">
          {edit && <div className="question-label">
            {edit ? (
              <select
                aria-label="题目类型"
                value={q.type}
                onChange={(e) => {
                  const type = e.target.value as Question["type"];
                  patchQuestion({
                    type,
                    options:
                      type === "boolean"
                        ? ["正确", "错误"]
                        : type === "choice"
                          ? ["", "", "", ""]
                          : [],
                    answer: type === "short" ? "" : "0",
                  });
                }}
              >
                {Object.entries(labels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <span>{labels[q.type]}</span>
            )}
            <span>
              {String(index + 1).padStart(2, "0")} /{" "}
              {String(active.questions.length).padStart(2, "0")}
            </span>
            {edit && (
              <button
                className="icon-button danger"
                aria-label="删除当前题目"
                onClick={() => {
                  if (
                    !window.confirm(
                      "删除这道题？此操作无法撤销，已有对象与作答历史会保留。",
                    )
                  )
                    return;
                  update({
                    ...active,
                    lastScore: undefined,
                    questions: active.questions.filter(
                      (item) => item.id !== q.id,
                    ),
                  });
                  goTo(
                    active.id,
                    active.questions[Math.max(0, index - 1)]?.id || "",
                  );
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>}
          {edit ? (
            <>
              <textarea
                className="question-prompt-input"
                placeholder="输入你的问题…"
                aria-label="题干"
                value={q.prompt}
                onChange={(e) => patchQuestion({ prompt: e.target.value })}
              />
              {q.type !== "short" ? (
                <div className="answer-options">
                  {q.options.map((option, i) => (
                    <div key={i} className="answer-option">
                      <input
                        type="radio"
                        name="correct-answer"
                        aria-label={`设选项${i + 1}为正确答案`}
                        checked={q.answer === String(i)}
                        onChange={() => patchQuestion({ answer: String(i) })}
                      />
                      <input
                        aria-label={`选项${i + 1}`}
                        value={option}
                        onChange={(e) =>
                          patchQuestion({
                            options: q.options.map((o, j) =>
                              i === j ? e.target.value : o,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <label>
                  参考答案
                  <textarea
                    value={q.answer}
                    onChange={(e) => patchQuestion({ answer: e.target.value })}
                    rows={3}
                  />
                </label>
              )}
              <label>
                答案解析
                <textarea
                  rows={3}
                  value={q.explanation}
                  onChange={(e) =>
                    patchQuestion({ explanation: e.target.value })
                  }
                />
              </label>
            </>
          ) : (
            <>
              <LearningObjectCard
                key={`${object.id}:${questionRevision(q)}`}
                object={object}
                projectId={projectId}
                expanded
                embedded
                attempts={attempts}
                onAttempt={onAttempt}
                onReferenceQuestion={onReferenceQuestion}
                onAskQuestion={onAskQuestion}
                drafts={drafts}
                onDraft={onDraft}
                onCitation={(evidence: Evidence) => onReadAnchor?.(evidence)}
              />
              {multiple && <nav className="practice-navigation" aria-label="切换题目">
                <button type="button" className="text-button" disabled={index === 0} onClick={() => goTo(active.id, active.questions[index - 1].id)}><ArrowLeft size={15}/>上一题</button>
                <select aria-label="当前题目" value={q.id} onChange={(event) => goTo(active.id, event.target.value)}>
                  {active.questions.map((question, questionIndex) => {
                    const result = questionView(questionObject(active.id, question).id, question, attempts, drafts).result;
                    return <option key={question.id} value={question.id}>第 {questionIndex + 1} / {active.questions.length} 题 · {result && result.result !== "skipped" ? "已作答" : result ? "已跳过" : "未作答"}</option>;
                  })}
                </select>
                <button type="button" className="text-button" disabled={index === active.questions.length - 1} onClick={() => goTo(active.id, active.questions[index + 1].id)}>下一题<ArrowRight size={15}/></button>
              </nav>}
              {multiple && summary.submitted === summary.total && <p className="practice-completion" role="status">本轮 {summary.total} 道题已作答{summary.needsReview ? `，还有 ${summary.needsReview} 道待核对或自评` : ""}。</p>}
            </>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <FileQuestion size={35} />
          <h2>从第一个问题开始</h2>
          <button
            className="button primary"
            onClick={() => {
              setEdit(true);
              addQuestion();
            }}
          >
            <Plus size={16} />
            添加题目
          </button>
        </div>
      )}
    </div>
  );
}
