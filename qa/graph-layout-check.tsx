/// <reference types="vite/client" />
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Graph from "../src/components/Graph";
import ConversationGraphCard from "../src/components/ConversationGraphCard";
import { applyTheme, type Theme } from "../src/theme";
import type { Concept, ReadingAnchor } from "../src/types";
import { graphFixture, graphFixtureChoices, type GraphFixtureId } from "./graph-fixtures.mjs";
import { buildLearningGraph, fitLearningGraph, learningEdgePath, type LearningLayoutMode, type LearningRelationKind } from "../src/learning-graph-layout.mjs";
import "../src/styles.css";
import "../src/reading-experience.css";
import "../src/learning-objects.css";
import "../src/concept-context.css";
import "../src/reader-shell.css";
import "../src/theme.css";
import "./graph-layout-check.css";

const query = new URLSearchParams(location.search);
const initialFixture = graphFixture(query.get("scene") || "chapter");
const dimensions = { main: { title: "主视觉 1000 × 640", width: 1000, height: 640 }, floating: { title: "浮窗 620 × 500", width: 620, height: 500 }, companion: { title: "并排 420 × 500", width: 420, height: 500 }, narrow: { title: "窄屏 320 × 360", width: 320, height: 360 } };
type Dimension = keyof typeof dimensions;
const initialDimension = query.get("size") as Dimension;
const projectId = "qa-graph-layout-memory-only";
const modes: { id: LearningLayoutMode; title: string; purpose: string }[] = [
  { id: "core", title: "核心展开", purpose: "以一个起点辨认主干与分支" },
  { id: "layers", title: "分层关系", purpose: "沿层次比较概念的承接" },
  { id: "network", title: "自由网络", purpose: "查看交叉联系与手动布局" },
];

function LayoutPrototype({ concepts, mode, relationKind }: { concepts: Concept[]; mode: LearningLayoutMode; relationKind: LearningRelationKind }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 380, height: 430 });
  const [zoom, setZoom] = useState(1);
  const model = useMemo(() => buildLearningGraph(concepts, { mode, relationKind, usePins: mode === "network" }), [concepts, mode, relationKind]);
  const byId = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model]);
  const fitted = useMemo(() => fitLearningGraph(model.nodes, size.width, size.height, { top: 20, bottom: 20, padding: 22, maxScale: 1 }), [model, size]);
  const camera = { k: fitted.k * zoom, x: size.width / 2 - (size.width / 2 - fitted.x) * zoom, y: size.height / 2 - (size.height / 2 - fitted.y) * zoom };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setSize({ width: entry.contentRect.width, height: 430 }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setZoom(1); }, [concepts, mode]);
  const choice = modes.find((item) => item.id === mode)!;
  return <figure className="graph-qa-prototype">
    <figcaption><strong>{choice.title}</strong><span>{choice.purpose}</span></figcaption>
    <div ref={viewport} className="graph-qa-prototype-canvas">
      <svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={`${choice.title}方案，${model.nodes.length}个概念的示例关系`}>
        <g transform={`translate(${camera.x},${camera.y}) scale(${camera.k})`}>
          {model.edges.map((edge) => <path key={edge.key} className={`graph-qa-prototype-edge${edge.tree ? " is-tree" : ""}${edge.cycle ? " is-cycle" : ""}`} d={learningEdgePath(edge, byId)} vectorEffect="non-scaling-stroke"/>)}
          {model.nodes.map((node) => <g key={node.id} transform={`translate(${node.x},${node.y})`} className={`graph-qa-prototype-node${node.isRoot ? " is-root" : ""}`}>
            <circle r={node.r}/><text x={node.label.x} y={node.label.y + node.label.fontSize} style={{ fontSize: node.label.fontSize }}>{node.label.lines.map((line, index) => <tspan key={index} x={node.label.x} dy={index ? node.label.lineHeight : 0}>{line}</tspan>)}</text>
          </g>)}
        </g>
      </svg>
    </div>
    <div className="graph-qa-prototype-footer"><small>{model.nodes.length} 个概念 · {model.edges.length} 条关联 · {Math.round(camera.k * 100)}%<br/>最小显示字号 {(Math.min(...model.nodes.map((node) => node.label.fontSize)) * camera.k).toFixed(1)} px</small><div><button type="button" aria-label={`缩小${choice.title}对照方案`} onClick={() => setZoom((value) => Math.max(.5, value / 1.3))}>−</button><button type="button" aria-label={`适应${choice.title}对照方案`} onClick={() => setZoom(1)}>适应</button><button type="button" aria-label={`放大${choice.title}对照方案`} onClick={() => setZoom((value) => Math.min(8, value * 1.3))}>+</button></div></div>
  </figure>;
}

function GraphLayoutCheck() {
  const [fixtureId, setFixtureId] = useState<GraphFixtureId>(initialFixture.id);
  const [concepts, setConcepts] = useState<Concept[]>(initialFixture.concepts);
  const [dimension, setDimension] = useState<Dimension>(initialDimension in dimensions ? initialDimension : "floating");
  const [inline, setInline] = useState(query.get("presentation") === "inline");
  const [theme, setTheme] = useState<Theme>(query.get("theme") === "dark" ? "dark" : "light");
  const [compare, setCompare] = useState(query.get("compare") === "1");
  const [epoch, setEpoch] = useState(0);
  const [references, setReferences] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<ReadingAnchor>();
  const [events, setEvents] = useState<string[]>([]);
  const receiver = useRef<HTMLDivElement>(null);
  const fixture = graphFixture(fixtureId);
  const size = dimensions[dimension];
  const log = (message: string) => setEvents((items) => [...items.slice(-7), message]);
  const reference = (id: string, kind = "点击") => {
    const concept = concepts.find((item) => item.id === id);
    if (!concept) return;
    setReferences((items) => items.includes(id) ? items : [...items, id]);
    log(`${kind}引用：${concept.name}；未发送`);
  };
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const element = receiver.current;
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.projectId === projectId) reference(detail.conceptId, "拖入");
    };
    element?.addEventListener("sidereader:concept-drop", receive);
    return () => element?.removeEventListener("sidereader:concept-drop", receive);
  }, [concepts]);
  const changeFixture = (id: GraphFixtureId) => {
    setFixtureId(id); setConcepts(graphFixture(id).concepts); setReferences([]); setSource(undefined); setEvents([]); setDraft(""); setEpoch((value) => value + 1);
  };
  const changeConcepts = (next: Concept[]) => {
    const pins = next.filter((concept) => concept.layout).length;
    setConcepts(next); log(`图谱编辑回调：${next.length} 个概念，${pins} 个固定点；仅内存`);
  };
  const openSource = (anchor: ReadingAnchor) => { setSource(anchor); log(`来源回调：第 ${anchor.page} 页；只展示示例`); };
  return <div className="graph-qa-shell compact-app reading-workbench">
    <header className="graph-qa-header"><div><h1>知识图谱布局验收</h1><p>全为示例数据与手工关系 · 仅内存 · 不读写用户项目，不调用模型</p></div><button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>切换为{theme === "light" ? "暗色" : "明亮"}</button></header>
    <div className="graph-qa-controls">
      <label>示例<select aria-label="选择图谱验收场景" value={fixtureId} onChange={(event) => changeFixture(event.target.value as GraphFixtureId)}>{graphFixtureChoices.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label>尺寸<select aria-label="选择图谱容器尺寸" value={dimension} onChange={(event) => setDimension(event.target.value as Dimension)}>{Object.entries(dimensions).map(([id, value]) => <option key={id} value={id}>{value.title}</option>)}</select></label>
      <label>呈现<select aria-label="选择图谱呈现" value={inline ? "inline" : "full"} onChange={(event) => setInline(event.target.value === "inline")}><option value="full">完整图谱</option><option value="inline">对话卡片</option></select></label>
      <button type="button" aria-expanded={compare} onClick={() => setCompare(!compare)}>{compare ? "收起三方案对照" : "比较三种布局"}</button>
      <button type="button" onClick={() => changeFixture(fixtureId)}>重置示例</button>
      <button type="button" onClick={() => {
        const root = document.querySelector(".network-workbench");
        const dim = root?.querySelector(".network-node.is-dim"), active = root?.querySelector(".network-node.is-selected");
        log(`样式：${document.documentElement.dataset.theme}；强调色 ${getComputedStyle(document.documentElement).getPropertyValue("--green")}；淡化节点 ${root?.querySelectorAll(".network-node.is-dim").length}，不透明度 ${dim ? getComputedStyle(dim).opacity : "无"}；选中 ${active?.getAttribute("aria-label") || "无"}`);
      }}>记录视图状态</button>
    </div>
    {compare && <section className="graph-qa-comparison" aria-label="同一份示例数据的三种布局"><p>同一份示例数据、全部概念、相同容器。此区比较空间结构；下方使用生产组件验证展开、平移、详情与引用。</p><div className="graph-qa-comparison-grid">{modes.map((mode) => <LayoutPrototype key={`${fixtureId}-${mode.id}`} concepts={concepts} mode={mode.id} relationKind={fixture.relationKind}/>)}</div></section>}
    <div className="graph-qa-layout">
      <main className="graph-qa-stage">
        <p className="graph-qa-description">{fixture.description}</p>
        <p className="graph-qa-spec">{concepts.length} 个概念 · {concepts.filter((concept) => concept.layout).length} 个固定点 · {inline ? "对话图谱中的示例普通关联" : fixture.relationKind === "prerequisite" ? "示例先修关联" : "示例普通关联"} · 容器 {size.width} × {size.height}</p>
        <div className="graph-qa-viewport-scroll"><div className={`graph-qa-viewport${inline ? " is-inline" : ""}`} style={{ width: size.width, height: inline ? undefined : size.height }}>
          {inline ? <ConversationGraphCard key={`inline-${fixtureId}-${epoch}`} graph={{ id: `qa-${fixtureId}`, title: `${fixture.title}（示例）`, concepts }} projectId={projectId} workspaceNodeId={`qa-${fixtureId}-card`}
            onReferenceConcept={reference} onReadAnchor={openSource} onOpen={() => { setInline(false); log("展开卡片：继续使用同一份内存概念"); }}/>
            : <Graph key={`${fixtureId}-${epoch}`} projectId={projectId} concepts={concepts} relationKind={fixture.relationKind} onChange={changeConcepts} onReferenceConcept={reference} onReadAnchor={openSource} onAskGraph={() => log("追问图谱回调；未发送")}/>}
        </div></div>
        <details className="graph-qa-checks" open><summary>此场景要核对的行为</summary><ul>{fixture.checks.map((check) => <li key={check}>{check}</li>)}<li>切换尺寸与亮暗后，节点详情、关闭返回、缩放与引用仍可用</li></ul></details>
      </main>
      <aside className="graph-qa-observer">
        <div ref={receiver} className="graph-qa-receiver" data-concept-drop={projectId}><h2>测试对话引用区</h2><p>将概念拖到这里；或打开详情后引用。不会发送。</p><ul>{references.map((id) => <li key={id}>{concepts.find((concept) => concept.id === id)?.name || id}</li>)}</ul><textarea aria-label="图谱验收对话草稿，不会发送" placeholder="草稿保留在本页内存…" value={draft} onChange={(event) => setDraft(event.target.value)}/><small>已引用 {references.length} 项 · 发送 0 次</small></div>
        <section><h2>来源回调</h2>{source ? <p>{source.title} · 第 {source.page} 页<br/>{source.quote}</p> : <p>尚未请求来源。</p>}</section>
        <section aria-label="图谱验收事件"><h2>内存事件</h2><ol>{events.map((event, index) => <li key={index}>{event}</li>)}</ol></section>
      </aside>
    </div>
  </div>;
}

if (import.meta.env.DEV) createRoot(document.getElementById("graph-qa-root")!).render(<GraphLayoutCheck/>);
else document.getElementById("graph-qa-root")!.textContent = "此页面仅用于本地开发验收。";
