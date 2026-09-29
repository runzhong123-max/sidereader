import type { ReactNode } from "react";
import { BookOpen, Check, MessageSquare, Pencil, Plus, Route, Trash2 } from "lucide-react";
import type { Concept, Evidence, LearningAttempt, LearningObject, Paper, PaperNode, Project, QuestionSet, ReadingAnchor, Stage, WorkspaceTab } from "../types";
import type { QuestionDraft } from "../question-state.mjs";
import { questionObject } from "../question-state.mjs";
import { readingDestination } from "../paper-navigation.mjs";
import { nodeTitle } from "../paper-tree-state.mjs";
import { surfaceContent } from "../domain/learning-surface.mjs";
import { graphProvenance, objectScopeLabel, questionOriginLabel } from "../object-provenance.mjs";
import Graph, { type AutomaticGraphState } from "./Graph";
import Questions from "./Questions";
import LearningObjectCard from "./LearningObjectCard";
import ReferenceScroll from "./ReferenceScroll";
import ObjectContext from "./ObjectContext";

type Props = {
  project: Project;
  target: WorkspaceTab;
  presentation: "main" | "comparison" | "floating";
  graphState?: AutomaticGraphState;
  overview: ReactNode;
  onNavigate: (target: WorkspaceTab) => void;
  onReadAnchor: (anchor: ReadingAnchor) => void;
  onCitation: (evidence: Evidence) => void;
  onReferenceConcept: (id: string) => void;
  onReferenceQuestion: (object: LearningObject) => void;
  onAskObject: () => void;
  onAskQuestion?: (object: LearningObject) => void;
  onConcepts: (concepts: Concept[]) => void;
  onEditStage: (stage: Stage) => void;
  onToggleStage: (stageId: string) => void;
  onRemoveStage: (stageId: string) => void;
  onEditGoal: () => void;
  onSets: (sets: QuestionSet[]) => void;
  onSetOrigin: (set: QuestionSet) => void;
  onGraphOrigin?: (node: PaperNode) => void;
  onObjectOrigin?: (paper: Paper) => void;
  onAttempt: (attempt: LearningAttempt) => void;
  onDraft: (objectId: string, draft: QuestionDraft) => void;
  onPosition: (setId: string, questionId: string) => void;
  onOpenObject: (object: LearningObject) => void;
};

/** One content implementation for the main pane, comparison pane and floating windows.
 * Presentation affects chrome only; identity, source navigation and edits use target.
 */
export default function LearningSurface(props: Props) {
  const { project, target, presentation, onReadAnchor } = props;
  const {node,concepts,stages,sets,setId,paper,object} = surfaceContent(project,target);
  const kind = node?.kind ?? target.kind;
  const compact = presentation !== "main";
  const title = node ? nodeTitle(project, node) : "学习对象";
  const scroll = (content: ReactNode) => <ReferenceScroll sessionKey={`${project.id}:${target.id}`}>{content}</ReferenceScroll>;
  const discussion = <div className="object-discussion-action"><button type="button" className="text-button" onClick={props.onAskObject}><MessageSquare size={14}/>追问这个{kind === "graph" ? "图谱" : "对象"}</button></div>;
  const readingLabel = (anchor: ReadingAnchor) => {
    const destination = readingDestination(project,anchor);
    return `${destination ? nodeTitle(project,destination) : anchor.title} · 第 ${anchor.page} 页`;
  };

  if (kind === "graph") {
    const provenance = graphProvenance(project, node);
    const graph = <Graph projectId={project.id} viewKey={`${project.id}:${target.id}`} concepts={concepts} relationKind={node?.graphConcepts ? "related" : "prerequisite"}
      automatic={props.graphState} onAskGraph={props.onAskObject} onChange={props.onConcepts} onReadAnchor={onReadAnchor} onReferenceConcept={props.onReferenceConcept} />;
    return <div className="reference-graph object-with-discussion" aria-label={title}>
      {provenance.origin && <ObjectContext label={provenance.label} scope={provenance.scope} originTitle={provenance.originTitle}
        onOrigin={node && props.onGraphOrigin ? () => props.onGraphOrigin?.(node) : undefined}/>}
      {graph}
    </div>;
  }

  if (kind === "path") {
    const content = <div className={compact ? "reference-document" : "page object-workspace path-page"}>
      <div className="object-workspace-heading"><div><h1>{title}</h1><p>{stages.filter((stage) => stage.done).length} / {stages.length} 已完成</p></div>
        {node?.role !== "stage" && <button className="button" onClick={() => props.onEditStage({id:crypto.randomUUID(),title:"",description:"",tag:"新的探索",done:false})}><Plus size={15}/>添加关卡</button>}
      </div>
      {!compact && <div className="project-goal-inline"><span>学习目标</span><p>{project.goal || "为项目设置一个学习目标。"}</p><button className="icon-button" aria-label="编辑学习目标" onClick={props.onEditGoal}><Pencil size={14}/></button></div>}
      <div className={compact ? "reference-stages" : "stages"}>{stages.map((stage, index) => <div className={compact ? "reference-stage" : `stage ${stage.done ? "complete" : ""}`} key={stage.id}>
        <button className={compact ? `reference-check ${stage.done ? "done" : ""}` : "stage-circle"} aria-label={`${stage.done ? "取消完成" : "完成关卡"}：${stage.title}`} onClick={() => props.onToggleStage(stage.id)}>{stage.done ? <Check size={compact ? 14 : 18}/> : !compact && String(index+1).padStart(2,"0")}</button>
        <div className="stage-card"><div>
          {!compact && <span className="stage-tag">{stage.done ? "已完成" : stage.tag}</span>}
          <h3>{stage.title}</h3><p>{stage.description}</p>
          {stage.deliverable && <p><strong>产物：</strong>{stage.deliverable}</p>}
          {stage.check && <p><strong>验收：</strong>{stage.check}</p>}
          {!!stage.prerequisites?.length && <p>先修：{stage.prerequisites.map((id) => project.stages.find((item) => item.id===id)?.title || id).join("、")}</p>}
          <div className="stage-reading-links">
            {stage.anchors?.map((anchor,i) => <button key={i} className="button small" onClick={() => onReadAnchor(anchor)}><BookOpen size={13}/>{readingLabel(anchor)}</button>)}
          </div>
        </div><div className="stage-actions">
          <button className="icon-button" aria-label={`编辑关卡：${stage.title}`} onClick={() => props.onEditStage({...stage})}><Pencil size={14}/></button>
          <button className="icon-button danger" aria-label={`删除关卡：${stage.title}`} onClick={() => props.onRemoveStage(stage.id)}><Trash2 size={14}/></button>
        </div></div>
      </div>)}</div>
      {!stages.length && <div className="empty-state"><Route size={30}/><p>在项目对话中规划学习目标，关卡会整理在这里。</p></div>}
    </div>;
    return scroll(content);
  }

  if (kind === "questions") {
    if (!setId) return props.overview;
    return <div className="object-with-discussion"><Questions projectId={project.id} initialSetId={setId} sets={sets} hideTitle
      scopeLabel={objectScopeLabel(project, target.id)}
      onOrigin={props.onSetOrigin} onReadAnchor={onReadAnchor}
      onChange={props.onSets} attempts={project.attempts || []} onAttempt={props.onAttempt} drafts={project.questionDrafts} onDraft={props.onDraft}
      positions={project.practicePositions} onPosition={props.onPosition} onOpenObject={props.onOpenObject} onReferenceQuestion={props.onReferenceQuestion} onAskQuestion={props.onAskQuestion || props.onAskObject} /></div>;
  }

  if (kind === "paper") {
    if (!paper || !object) return <div className="empty-state">学习对象不存在</div>;
    const questionSet = object.kind === "question" ? project.sets.find((set) => set.questions.some((question) => questionObject(set.id, question).id === object.id)) : undefined;
    const originNode = project.paperTree?.nodes.find((item) => item.id === paper.parentId && item.kind === "chat");
    const originChat = originNode && project.chats.find((chat) => chat.id === (originNode.objectId || originNode.id));
    const hasOrigin = Boolean(paper.sourceMessageId && originChat?.messages.some((message) => message.id === paper.sourceMessageId));
    const returnToOrigin = hasOrigin && props.onObjectOrigin ? () => props.onObjectOrigin?.(paper) : undefined;
    return scroll(<div className={compact ? "reference-document" : "paper-workspace"}>
      <div className={compact ? undefined : "paper-layout"}><div className={compact ? undefined : "paper-object-view"}>
        <ObjectContext label={object.kind === "question" ? questionSet ? questionOriginLabel(questionSet) : "习题" : hasOrigin ? "对话中的材料" : "学习材料"} scope={objectScopeLabel(project, target.id)} originTitle={originChat?.title}
          onOrigin={returnToOrigin || (questionSet?.sourceMessageId ? () => props.onSetOrigin(questionSet) : undefined)}/>
        <LearningObjectCard key={object.id} expanded object={object} projectId={project.id} workspaceNodeId={target.id} evidence={paper.evidence} onCitation={props.onCitation}
          attempts={project.attempts} onAttempt={props.onAttempt} drafts={project.questionDrafts} onDraft={props.onDraft} onReferenceQuestion={props.onReferenceQuestion} onAskQuestion={props.onAskQuestion || props.onAskObject}/>
        {object.kind !== "question" && discussion}
        {!!paper.evidence.length && <details className="paper-source-links"><summary>本轮检索资料 · {paper.evidence.length}</summary><div>
          {paper.evidence.map((evidence) => <button key={evidence.id} className="button small" onClick={() => props.onCitation(evidence)}>回到原文 · {evidence.title} · {evidence.page}</button>)}
        </div></details>}
      </div></div>
    </div>);
  }
  return null;
}
