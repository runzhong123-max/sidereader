import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronDown, FileQuestion, Pencil, Plus } from "lucide-react";
import type { Evidence, LearningAttempt, Project } from "../types";
import type { QuestionDraft } from "../question-state.mjs";
import { practiceCatalog, type PracticeEntry } from "../practice-catalog.mjs";
import { nodeTitle } from "../paper-tree-state.mjs";
import LearningObjectCard from "./LearningObjectCard";
import ActionMenu from "./ActionMenu";
import "../practice-overview.css";

type Filter = "all" | PracticeEntry["status"];
const filters: { id: Filter; title: string }[] = [
  { id: "all", title: "全部" },
  { id: "unanswered", title: "未作答" },
  { id: "review", title: "需复习" },
  { id: "answered", title: "已作答" },
];

export default function PracticeOverview({ project, onGenerate, onCreateSet, onManageSet, onOrigin, onOpenObject, onAttempt, onDraft, onCitation }: {
  project: Project;
  onGenerate: (scopeId: string, purpose: "check" | "practice" | "textbook") => void;
  onCreateSet: () => void;
  onManageSet: (setId: string) => void;
  onOrigin: (entry: PracticeEntry) => void;
  onOpenObject: (entry: PracticeEntry) => void;
  onAttempt: (attempt: LearningAttempt) => void;
  onDraft: (objectId: string, draft: QuestionDraft) => void;
  onCitation: (evidence: Evidence) => void;
}) {
  const entries = useMemo(() => practiceCatalog(project), [project]);
  const [scope, setScope] = useState("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [activeId, setActiveId] = useState<string>();
  const scopes = useMemo(() => {
    const result = new Map<string, string>();
    result.set("project", "项目对话");
    for (const node of project.paperTree?.nodes || []) {
      if (node.role === "chapter") result.set(node.id, nodeTitle(project, node));
    }
    for (const entry of entries) result.set(entry.scopeId, entry.scopeTitle);
    return [...result].map(([id, title]) => ({ id, title }));
  }, [project, entries]);
  const scoped = entries.filter((entry) => scope === "all" || entry.scopeId === scope);
  const shown = scoped.filter((entry) => filter === "all" || entry.status === filter);
  const collections = project.sets.filter((set) => set.presentation !== "inline" && shown.some((entry) => entry.setId === set.id));
  const collectionIds = new Set(collections.map((set) => set.id));
  const quickChecks = shown.filter((entry) => !entry.setId || !collectionIds.has(entry.setId));
  // Keep the open question visible when submitting changes its filter status.
  const active = entries.find((entry) => entry.id === activeId);
  const generateScope = scope === "all" ? "project" : scope;

  if (active) return (
    <div className="page practice-overview practice-detail">
      <button className="text-button muted" onClick={() => setActiveId(undefined)}><ArrowLeft size={15}/>返回练习</button>
      <div className="practice-detail-heading">
        <span>{active.scopeTitle} · {active.statusLabel}</span>
        {active.originNodeId && <button className="text-button" onClick={() => onOrigin(active)} title={active.originTitle}>
          查看来源<ArrowUpRight size={14}/>
        </button>}
      </div>
      <LearningObjectCard key={active.id} expanded object={active.object} evidence={active.evidence} onCitation={onCitation}
        projectId={project.id} workspaceNodeId={project.papers?.find((paper) => paper.object.id === active.object.id)?.id}
        onOpen={() => onOpenObject(active)}
        attempts={project.attempts} onAttempt={onAttempt} drafts={project.questionDrafts} onDraft={onDraft}/>
    </div>
  );

  return (
    <div className="page practice-overview">
      <div className="page-heading">
        <div><h1>练习</h1><p>回看随堂检测，继续项目和章节里的练习。作答记录与原对话同步。</p></div>
        <ActionMenu label="新练习" trigger={<><Plus size={16}/>新练习<ChevronDown size={13}/></>}>
          <button onClick={() => onGenerate(generateScope,"check")}>随堂检测 · 一两道题</button>
          <button onClick={() => onGenerate(generateScope,"practice")}>生成连续练习</button>
          <button onClick={() => onGenerate(generateScope,"textbook")}>整理教材习题</button>
        </ActionMenu>
      </div>
      <div className="practice-filterbar">
        <div className="practice-filters" role="group" aria-label="按作答状态筛选">
          {filters.map(({ id, title }) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {title}<span>{id === "all" ? scoped.length : scoped.filter((entry) => entry.status === id).length}</span>
          </button>)}
        </div>
        <select aria-label="练习范围" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="all">整个项目</option>
          {scopes.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        </select>
      </div>
      {shown.length ? <ul className="practice-list">
        {collections.map((set) => {
          const questions = scoped.filter((entry) => entry.setId === set.id);
          const unanswered = questions.filter((entry) => entry.status === "unanswered").length;
          const review = questions.filter((entry) => entry.status === "review").length;
          return <li key={set.id}>
            <button className="practice-open" onClick={() => onManageSet(set.id)}>
              <span className="practice-question-title"><FileQuestion size={16}/> {set.title}</span>
              <span className="practice-question-meta">{questions[0]?.scopeTitle} · {set.origin === "textbook" ? "教材习题" : set.origin === "generated" ? "生成练习" : "自编题集"} · {questions.length} 道题</span>
            </button>
            <span className={`practice-state ${review ? "review" : ""}`}>{[unanswered ? `${unanswered} 道未作答` : "", review ? `${review} 道需复习` : ""].filter(Boolean).join(" · ") || "已作答"}</span>
          </li>;
        })}
        {quickChecks.map((entry) => <li key={entry.id}>
          <button className="practice-open" onClick={() => setActiveId(entry.id)}>
            <span className="practice-question-title">{entry.object.question?.prompt}</span>
            <span className="practice-question-meta">{entry.scopeTitle} · {entry.originTitle}</span>
          </button>
          <span className={`practice-state ${entry.status}`}>{entry.statusLabel}</span>
        </li>)}
      </ul> : <div className="practice-empty">
        <h2>{entries.length ? "这个范围暂时没有符合条件的题目" : "还没有练习题"}</h2>
        <p>{entries.length ? "可以换一个范围或作答状态，也可以让 Tutor 围绕当前范围出题。" : "在对话中请 Tutor 用一两道题检验理解，或整理一份连续练习、教材习题。生成后会保存在这里，不必先创建空文件。"}</p>
      </div>}
      {entries.some((entry) => entry.status === "review") && <p className="practice-status-note">需复习包含答错、参考提示后答对、待自评及待核对的题目。作答记录不自动改变关卡完成状态。</p>}
      <details className="practice-manual">
        <summary><ChevronDown size={14}/>手工编题与草稿</summary>
        <p>需要自己编题时使用。空白草稿只保留在这里。</p>
        {project.sets.filter((set) => !set.questions.length).map((set) => <div className="practice-set-row" key={set.id}>
          <button className="text-button" onClick={() => onManageSet(set.id)}><Pencil size={14}/>{set.title}</button>
          <small>{set.questions.filter((question) => question.prompt.trim()).length} 道题</small>
        </div>)}
        <button className="text-button" onClick={onCreateSet}><Plus size={14}/>自编题集</button>
      </details>
    </div>
  );
}
