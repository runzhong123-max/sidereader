/// <reference types="vite/client" />
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Questions from "../src/components/Questions";
import LearningObjectCard from "../src/components/LearningObjectCard";
import ReferenceSnapshot from "../src/components/ReferenceSnapshot";
import ConversationGraphCard from "../src/components/ConversationGraphCard";
import Graph from "../src/components/Graph";
import EvidenceCitation from "../src/components/EvidenceCitation";
import { questionObject } from "../src/question-state.mjs";
import { applyTheme, type Theme } from "../src/theme";
import type { Concept, Evidence, LearningAttempt, LearningObject, Question, QuestionSet, ReadingAnchor } from "../src/types";
import type { QuestionDraft } from "../src/question-state.mjs";
import "../src/styles.css";
import "../src/reading-experience.css";
import "../src/learning-objects.css";
import "../src/concept-context.css";
import "../src/reader-shell.css";
import "../src/theme.css";
import "./ui-check.css";

const projectId = "qa-memory-only";
const anchor: ReadingAnchor = { sourceId: "qa-textbook", title: "测试教材（示例）", page: 69, quote: "线性模型将属性的线性组合作为预测结果。这里仅为验收示例，不是用户原文。" };
const evidence: Evidence = { ...anchor, id: "qa-evidence", text: `${anchor.quote}\n\n${"长摘录验收：可以滚动核对这段来源，只有点击打开原文才触发来源回调。".repeat(16)}` };
const choice: Question = { id: "choice", type: "choice", prompt: "【测试题】线性模型 f(x)=wx+b 中，哪一项是权重？", options: ["w", "b", "x"], answer: "0", explanation: "w 是权重，b 是偏置，x 是输入。此解析应在提交后出现。", hint: "看看哪一个量与输入 x 相乘。", anchors: [anchor] };
const single: LearningObject = { ...questionObject("qa-single", choice), title: "单题检测（测试数据）" };
const missing: LearningObject = questionObject("qa-missing", { ...choice, id: "missing", prompt: "【无答案教材题】给出一个你认为适合用线性模型描述的情形，并解释原因。", type: "short", options: [], answer: "", explanation: "", answerStatus: "missing", sourceQuestionNumber: "3.1", hint: undefined });
const initialSets: QuestionSet[] = [{
  id: "qa-set", title: "三题练习（测试数据）", description: "选择题答错后可重试；判断题可跳过再返回；简答题由你明确自评。", origin: "generated", presentation: "collection", sourceMessageId: "qa-source-answer", anchors: [anchor],
  questions: [choice,
    { id: "boolean", type: "boolean", prompt: "【测试题】偏置 b 必须等于零。", options: ["正确", "错误"], answer: "1", explanation: "偏置不必为零。此解析不能因跳过而显示。" },
    { id: "short", type: "short", prompt: "【测试题】用一句话说明权重与偏置的区别。", options: [], answer: "权重决定输入的影响，偏置调整整体偏移。", explanation: "简答需阅读参考答案后明确自评。" },
  ],
}];
const names = ["线性模型", "线性回归", "多元线性回归", "最小二乘法", "均方误差", "对数几率回归", "对数几率函数", "极大似然估计", "线性判别分析（LDA）", "类内散度矩阵", "类间散度矩阵", "广义瑞利商", "多分类学习", "一对一（OvO）", "一对其余（OvR）", "多对多与纠错输出码", "类别不平衡问题", "再缩放与欠采样", "过采样与阈值移动", "属性权重与可解释性"];
const initialConcepts: Concept[] = names.map((name, index) => ({ id: `qa-concept-${index}`, name, description: `【测试解释】${name}用于验证概念详情的可见性与滚动。\n\n${"这是保存在提问时的长内容示例。阅读后可以回到图谱，或仅将概念引用到输入区。".repeat(index === 0 ? 18 : 3)}`, x: 0, y: 0, group: 0, links: [`qa-concept-${(index + 1) % names.length}`, `qa-concept-${index % 5}`], anchors: [anchor] }));
const scenes = { single: "单题", multiple: "多题练习", missing: "无答案教材题", references: "长引用与来源", graph: "对话图谱", fullgraph: "20 概念浮窗尺寸" };
type Scene = keyof typeof scenes;
const initialScene = new URLSearchParams(location.search).get("scene") as Scene;

function UiCheck() {
  const [scene, setScene] = useState<Scene>(initialScene in scenes ? initialScene : "single");
  const [theme, setTheme] = useState<Theme>(new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light");
  const [sets, setSets] = useState(() => structuredClone(initialSets));
  const [concepts, setConcepts] = useState(() => structuredClone(initialConcepts));
  const [attempts, setAttempts] = useState<LearningAttempt[]>([]);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [positions, setPositions] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [source, setSource] = useState<ReadingAnchor>();
  const [epoch, setEpoch] = useState(0);
  const receiver = useRef<HTMLDivElement>(null);
  const log = (message: string) => setEvents((current) => [...current.slice(-7), message]);
  useEffect(() => { applyTheme(theme); }, [theme]); // apply only: never save the user's theme preference.
  useEffect(() => {
    const element = receiver.current;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const concept = initialConcepts.find((item) => item.id === detail?.conceptId);
      if (detail?.projectId !== projectId || !concept) return;
      setReferences((items) => items.includes(concept.name) ? items : [...items, concept.name]);
      log(`拖入引用：${concept.name}；未发送`);
    };
    element?.addEventListener("sidereader:concept-drop", receive);
    return () => element?.removeEventListener("sidereader:concept-drop", receive);
  }, []);
  const onAttempt = (attempt: LearningAttempt) => { setAttempts((current) => [...current, attempt]); log(`作答记录：${attempt.result}`); };
  const onDraft = (objectId: string, value: QuestionDraft) => setDrafts((current) => ({ ...current, [objectId]: value }));
  const openSource = (value: ReadingAnchor) => { setSource(value); log(`来源回调：${value.title} · 第 ${value.page} 页`); };
  const referenceQuestion = (object: LearningObject) => { setReferences((items) => [...new Set([...items, object.title])]); log(`习题引用：${object.title}；未发送`); };
  const referenceConcept = (id: string) => { const concept = concepts.find((item) => item.id === id); if (concept) { setReferences((items) => [...new Set([...items, concept.name])]); log(`概念引用：${concept.name}；未发送`); } };
  const reset = () => { setSets(structuredClone(initialSets)); setConcepts(structuredClone(initialConcepts)); setAttempts([]); setDrafts({}); setPositions({}); setReferences([]); setDraft(""); setEvents([]); setSource(undefined); setEpoch((value) => value + 1); };
  const shared = { projectId, attempts, drafts, onAttempt, onDraft, onCitation: openSource, onReferenceQuestion: referenceQuestion };
  return <div className="qa-shell compact-app reading-workbench">
    <header className="qa-header">
      <div><h1>SideReader 开发验收</h1><p>全部为测试数据 · 仅内存状态 · 不读取或写入用户项目 · 不调用模型</p></div>
      <div className="qa-controls"><button type="button" className="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>切换为{theme === "light" ? "暗色" : "明亮"}</button><button type="button" className="button" onClick={reset}>重置测试</button></div>
    </header>
    <nav className="qa-scenes" aria-label="验收场景">{Object.entries(scenes).map(([id, title]) => <button type="button" key={id} aria-current={scene === id ? "page" : undefined} onClick={() => setScene(id as Scene)}>{title}</button>)}</nav>
    <div className="qa-layout">
      <main className="qa-stage" key={epoch}>
        {scene === "single" && <><p className="qa-instruction">先选 b 提交，查看错误反馈；点“再做一次”选 w；重置后可检查“暂时跳过”不泄露答案。</p><LearningObjectCard {...shared} object={single} onOpen={() => log("展开单题回调；此处仅验证组件事件")} /></>}
        {scene === "multiple" && <Questions {...shared} sets={sets} initialSetId="qa-set" onChange={setSets} positions={positions} onPosition={(id, questionId) => setPositions((current) => ({ ...current, [id]: questionId }))} onOpenObject={() => log("独立对象展开回调")} onOrigin={() => log("生成对话回调（测试）")} onReadAnchor={openSource} onAskQuestion={(object) => { referenceQuestion(object); log("专属题目对话回调；未发送"); }} scopeLabel="测试章节" />}
        {scene === "missing" && <><p className="qa-instruction">输入回答并提交：应为“待核对”，不出现凭空答案或“回答正确”，也不能进行答案自评。</p><LearningObjectCard {...shared} object={missing} expanded onAskQuestion={(object) => { referenceQuestion(object); log("专属题目对话回调；未发送"); }} /></>}
        {scene === "references" && <><p className="qa-instruction">展开历史概念/习题快照，检查长内容不截断；点击来源编号先预览，明确“打开原文”才触发右侧来源回调。</p><div className="qa-reference-fixture message-concept-references">
          <ReferenceSnapshot concept={concepts[0]} onReadAnchor={openSource}/>
          <ReferenceSnapshot question={{ id: single.id, title: "历史习题快照（测试）", question: { ...choice, prompt: `【测试长题干】${"这道题保留提问时的选项，不包含参考答案与解析。".repeat(20)}` } }} onReadAnchor={openSource}/>
        </div><p className="qa-citation-line">来源预览测试：<EvidenceCitation evidence={evidence} onOpen={openSource} className="inline-citation">1</EvidenceCitation></p></>}
        {scene === "graph" && <><p className="qa-instruction">在卡片点节点应就地显示解释；返回后恢复图谱。可把节点拖到右侧引用区，或点击“引用到对话”。</p><div className="conversation qa-conversation"><p className="qa-graph-spacer">这是测试对话的前文。向下滚动到图谱后点“线性模型”，检查长解释与返回位置。</p><ConversationGraphCard graph={{ id: "qa-graph", title: "对话中的线性模型（测试）", concepts: concepts.slice(0, 6) }} projectId={projectId} workspaceNodeId="qa-graph-node" onReferenceConcept={referenceConcept} onReadAnchor={openSource} onOpen={() => setScene("fullgraph")}/><p className="qa-graph-after">图谱后的正文（测试）。</p></div></>}
        {scene === "fullgraph" && <><p className="qa-instruction">真实 Graph 组件，620×500 CSS 像素容器；全部 20 概念。检查缩放、标签、固定位置、解释返回和拖入引用。</p><div className="qa-fullgraph"><Graph key={`graph-${epoch}`} projectId={projectId} concepts={concepts} onChange={setConcepts} onReadAnchor={openSource} onReferenceConcept={referenceConcept}/></div></>}
      </main>
      <aside className="qa-observer">
        <div ref={receiver} className="qa-reference-receiver" data-concept-drop={projectId}><h2>测试引用区</h2><p>只接收引用，不提供发送按钮。</p><ul>{references.map((label) => <li key={label}>{label}</li>)}</ul><textarea aria-label="测试对话草稿，不会发送" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="可输入草稿；不会发送"/></div>
        <section className="qa-source"><h2>来源回调</h2>{source ? <><strong>{source.title} · 第 {source.page} 页</strong><p>{source.quote || "测试回调已收到；此页不会打开或修改用户 PDF。"}</p></> : <p>尚未打开来源。</p>}</section>
        <section className="qa-events" aria-label="测试事件记录"><h2>内存事件</h2><ol>{events.map((event, index) => <li key={index}>{event}</li>)}</ol><p>记录 {attempts.length} 条 · 已引用 {references.length} 项 · 发送 0 次</p></section>
      </aside>
    </div>
  </div>;
}

if (import.meta.env.DEV) createRoot(document.getElementById("qa-root")!).render(<UiCheck/>);
else document.getElementById("qa-root")!.textContent = "此页面仅用于本地开发验收。";
