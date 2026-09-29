import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Minus,
  X,
  Pencil,
  Trash2,
  Check,
  Search,
  Maximize,
  SlidersHorizontal,
  RotateCcw,
  ArrowUpRight,
  ArrowLeft,
  Network,
  Pin,
  LoaderCircle,
  CircleAlert,
  MessageSquarePlus,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { Concept, GraphCoverage, ReadingAnchor } from "../types";
import {
  graphData,
  neighborhood,
  type Camera,
} from "../graph-layout.mjs";
import { buildLearningGraph, fitLearningGraph, learningEdgePath, type LearningLayoutMode, type LearningRelationKind, type LearningNode } from "../learning-graph-layout.mjs";
import { readingGraphCamera, readableGraphScale, resizeGraphCamera, zoomGraphCamera } from "../graph-camera.mjs";
import { relaxLearningNeighborhood } from "../graph-focus-layout.mjs";
import "../graph.css";
import ActionMenu from "./ActionMenu";
import GraphMinimap from "./GraphMinimap";
import GraphRelations from "./GraphRelations";
import { conceptDropTarget, deliverConceptDrop, markConceptDropTarget } from "../concept-pointer-drop.mjs";
type GraphLocation = {
  camera: Camera;
  width: number;
  height: number;
  selected: string | null;
  detailOpen: boolean;
  local: boolean;
  depth: number;
  sourceFilter: string;
  spread: number;
  arrows: boolean;
  orphans: boolean;
  inspectorScrollTop: number;
  mode: LearningLayoutMode;
  rootId?: string;
  expanded: string[];
  all: boolean;
  autoFit: boolean;
  relaxFocus: boolean;
  focusBase: LearningNode[] | null;
  geometrySignature: string;
  localPins: Record<string, { x: number; y: number }>;
};
type GraphView = GraphLocation & { history?: GraphLocation[] };
const layoutChoices = [
  { value: "core" as const, label: "核心展开", description: "从起点看主干，逐步展开分支" },
  { value: "layers" as const, label: "分层关系", description: "沿层次梳理概念的承接" },
  { value: "network" as const, label: "自由网络", description: "探索交叉联系，自由调整位置" },
];
// Navigation restores the same view for this session. Editors remain transient.
const graphViews = new Map<string, GraphView>();
export type AutomaticGraphState = {
  status: "generating" | "error" | "waiting-model" | "waiting-source" | "idle" | "empty";
  message?: string;
  coverage?: GraphCoverage;
  scopeLabel?: string;
  busy?: boolean;
  onRetry?: () => void;
  onSettings?: () => void;
};
export default function Graph({
  concepts,
  onChange,
  compact = false,
  onOpen,
  onReadAnchor,
  viewKey,
  automatic,
  projectId,
  onReferenceConcept,
  relationKind = "prerequisite",
  inline = false,
  onAskGraph,
}: {
  concepts: Concept[];
  onChange?: (c: Concept[]) => void;
  compact?: boolean;
  onOpen?: () => void;
  onReadAnchor?: (a: ReadingAnchor) => void;
  viewKey?: string;
  automatic?: AutomaticGraphState;
  projectId?: string;
  onReferenceConcept?: (conceptId: string) => void;
  relationKind?: LearningRelationKind;
  inline?: boolean;
  onAskGraph?: () => void;
}) {
  const geometrySignature = `${relationKind}|` + concepts.map((c) => `${c.id}:${c.name}:${c.links.join(",")}:${c.layout?.x}:${c.layout?.y}`).join(";");
  const rememberedView = useRef(viewKey ? graphViews.get(viewKey) : undefined);
  const initialSelected = concepts.some((concept) => concept.id === rememberedView.current?.selected)
    ? rememberedView.current!.selected : null;
  const initialFilter = rememberedView.current?.sourceFilter || "";
  const root = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    inspector = useRef<HTMLElement>(null);
  const inspectorPosition = useRef({
    id: initialSelected,
    top: initialSelected ? rememberedView.current?.inspectorScrollTop || 0 : 0,
  });
  const [size, setSize] = useState({ width: rememberedView.current?.width || 900, height: rememberedView.current?.height || 570 });
  const [measured, setMeasured] = useState(false);
  const [mode, setMode] = useState<LearningLayoutMode>(rememberedView.current?.mode || "core");
  const [rootId, setRootId] = useState<string | undefined>(rememberedView.current?.rootId);
  const [expanded, setExpanded] = useState<string[]>(rememberedView.current?.expanded || []);
  const [all, setAll] = useState(rememberedView.current?.all || false);
  const [relaxFocus, setRelaxFocus] = useState(rememberedView.current?.relaxFocus ?? true);
  const [focusBase, setFocusBase] = useState<LearningNode[] | null>(rememberedView.current?.geometrySignature === geometrySignature ? rememberedView.current.focusBase : null);
  const [localPins, setLocalPins] = useState<Record<string, { x: number; y: number }>>(rememberedView.current?.localPins || {});
  const [history, setHistory] = useState<GraphLocation[]>(rememberedView.current?.geometrySignature === geometrySignature ? rememberedView.current.history || [] : []);
  const autoFit = useRef(rememberedView.current?.autoFit ?? true);
  const [selected, setSelected] = useState<string | null>(initialSelected),
    [hovered, setHovered] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(Boolean(initialSelected && rememberedView.current?.detailOpen !== false));
  const [query, setQuery] = useState(""),
    [local, setLocal] = useState(Boolean(initialSelected && rememberedView.current?.local)),
    [depth, setDepth] = useState(rememberedView.current?.depth || 1),
    [sourceFilter, setSourceFilter] = useState(concepts.some((concept) => concept.anchors?.some((anchor) => anchor.sourceId === initialFilter)) ? initialFilter : "");
  const [spread, setSpread] = useState(rememberedView.current?.spread || 150),
    [arrows, setArrows] = useState(rememberedView.current?.arrows || false),
    [orphans, setOrphans] = useState(rememberedView.current?.orphans ?? true);
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [links, setLinks] = useState<string[]>([]);
  const editOrigin = useRef<{ selected: string | null; detailOpen: boolean } | null>(null);
  const [camera, setCamera] = useState<Camera>(rememberedView.current?.camera || { x: 450, y: 285, k: 1 }),
    [dragPositions, setDragPositions] = useState<
      Record<string, { x: number; y: number }>
    >({});
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const positionsRef = useRef(dragPositions);
  positionsRef.current = dragPositions;
  const [transferPreview, setTransferPreview] = useState<{ id: string; x: number; y: number; canDrop: boolean } | null>(null);
  const dropTarget = useRef<HTMLElement | null>(null);
  const nativeDragAt = useRef(0);
  const gesture = useRef<{
      id?: string;
      pointer: number;
      x: number;
      y: number;
      startX: number;
      startY: number;
      moved: boolean;
      initialPositions: Record<string, { x: number; y: number }>;
      initialNode?: { x: number; y: number };
      initialCamera: Camera;
      initialAutoFit: boolean;
      outside: boolean;
    } | null>(null),
    suppressClick = useRef(false);
  const cancelGesture = useRef(() => {});
  cancelGesture.current = () => end(undefined, true);
  useEffect(() => {
    const cancel = () => cancelGesture.current();
    const hide = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => () => {
    dropTarget.current?.removeAttribute("data-concept-drag-over");
    dropTarget.current = null;
    const pointer = gesture.current?.pointer;
    gesture.current = null;
    if (pointer !== undefined && svg.current?.hasPointerCapture(pointer)) svg.current.releasePointerCapture(pointer);
  }, []);
  const unique = useId().replace(/:/g, "");
  const network = useMemo(() => graphData(concepts), [concepts]);
  const learningGraph = useMemo(() => buildLearningGraph(mode === "network" ? concepts.map((c) => localPins[c.id] ? { ...c, layout: localPins[c.id] } : c) : concepts, { mode, rootId, spread: spread / 150, relationKind, usePins: mode === "network" }), [concepts, mode, rootId, spread, relationKind, localPins]);
  const previousGeometry = useRef(geometrySignature);
  useEffect(() => {
    if (previousGeometry.current !== geometrySignature) { setFocusBase(null); setHistory([]); previousGeometry.current = geometrySignature; }
  }, [geometrySignature]);
  const layout = useMemo(() => mode === "network" && selected && relaxFocus
    ? relaxLearningNeighborhood({ ...learningGraph, nodes: focusBase && focusBase.length === learningGraph.nodes.length && focusBase.every((n, i) => n.id === learningGraph.nodes[i].id) ? learningGraph.nodes.map((n, i) => ({ ...n, x: focusBase[i].x, y: focusBase[i].y })) : learningGraph.nodes }, selected, depth) : learningGraph.nodes,
  [learningGraph, mode, selected, depth, relaxFocus, focusBase]);
  const nodes = useMemo(
    () => layout.map((n) => ({ ...n, ...(mode === "network" ? dragPositions[n.id] : {}) })),
    [layout, dragPositions, mode],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const active = concepts.find((c) => c.id === selected);
  const detailVisible = detailOpen && Boolean(active || editing);
  const narrow = size.width <= 650;
  const fullDetail = !compact && narrow && detailVisible;
  const filterAvailable = !sourceFilter || concepts.some((concept) => concept.anchors?.some((anchor) => anchor.sourceId === sourceFilter));
  useLayoutEffect(() => {
    if (selected && !active) {
      setSelected(null);
      setLocal(false);
      setDetailOpen(false);
    }
    if (!filterAvailable) setSourceFilter("");
  }, [selected, Boolean(active), filterAvailable]);
  useLayoutEffect(() => {
    if (editing) return;
    const id = active?.id || null;
    if (inspectorPosition.current.id !== id) inspectorPosition.current = { id, top: 0 };
    if (inspector.current) inspector.current.scrollTop = inspectorPosition.current.top;
  }, [active?.id, editing, detailVisible]);
  useLayoutEffect(() => {
    if (!fullDetail) return;
    inspector.current?.querySelector<HTMLElement>(editing ? "input" : "[data-graph-return]")?.focus({ preventScroll: true });
  }, [fullDetail, editing, active?.id]);
  const localIds = useMemo(
    () => neighborhood(network.neighbors, selected, depth),
    [network, selected, depth],
  );
  const expandedIds = useMemo(() => new Set(expanded), [expanded]);
  const branchIds = useMemo(() => {
    const visible = new Set<string>();
    const visit = (id: string) => {
      if (visible.has(id)) return;
      const node = byId.get(id);
      if (!node) return;
      visible.add(id);
      if (expandedIds.has(id)) node.childIds.forEach(visit);
      else if (node.isRoot) node.childIds.slice(0, 5).forEach(visit);
    };
    learningGraph.roots.forEach(visit);
    return visible;
  }, [learningGraph.roots, byId, expandedIds]);
  const shown = useMemo(() => concepts.filter(
    (c) =>
      (!local || !selected || localIds.has(c.id)) &&
      (local || all || sourceFilter || mode !== "core" || branchIds.has(c.id)) &&
      (!sourceFilter || c.anchors?.some((a) => a.sourceId === sourceFilter)) &&
      (orphans || network.neighbors.get(c.id)!.size > 0),
  ), [concepts, local, selected, localIds, sourceFilter, orphans, network, all, mode, branchIds]);
  const shownIds = new Set(shown.map((c) => c.id)),
    shownEdges = learningGraph.edges.filter(
      (e) => shownIds.has(e.source) && shownIds.has(e.target),
    );
  const highlightId = selected && shownIds.has(selected) ? selected : hovered && shownIds.has(hovered) ? hovered : null;
  const highlightDepth = selected && shownIds.has(selected) ? depth : 1;
  const emphasized = useMemo(() => neighborhood(network.neighbors, highlightId, highlightDepth), [network, highlightId, highlightDepth]);
  const highlightDistances = useMemo(() => {
    const distances = new Map<string, number>();
    for (let level = 0; level <= highlightDepth; level++) for (const id of neighborhood(network.neighbors, highlightId, level)) if (!distances.has(id)) distances.set(id, level);
    return distances;
  }, [network, highlightId, highlightDepth]);
  const results = query.trim()
    ? concepts
        .filter((c) =>
          (c.name + " " + c.description)
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];
  const sourceOptions = [
    ...new Map(
      concepts
        .flatMap((c) => c.anchors || [])
        .map((a) => [a.sourceId, a.title]),
    ).entries(),
  ];
  const automaticEmpty = concepts.length === 0 && automatic;
  const coverage = automatic?.coverage;
  const coverageMessage = coverage
    ? `已参考 ${coverage.sampledPages}/${coverage.totalPages} 页 · ${coverage.sampledChunks}/${coverage.totalChunks} 段原文${coverage.truncated ? "（部分节选）" : ""}`
    : "";
  const sparseMessage = automatic?.status === "idle" && concepts.length > 0 && concepts.length < 4
    ? "当前概念较少，可继续补全" : "";
  const fitOptions = { top: coverageMessage || sparseMessage ? 68 : 38, bottom: size.width <= 380 ? 86 : 54, padding: inline ? 18 : 28, maxScale: 1 };
  const automaticTitle = automatic?.status === "generating" ? "正在生成知识图谱"
    : automatic?.status === "error" ? "知识图谱生成未完成"
    : automatic?.status === "empty" ? "知识图谱为空"
    : automatic?.status === "waiting-model" ? "配置模型后自动生成"
    : automatic?.status === "waiting-source" ? "等待资料内容"
    : "知识图谱会自动整理";
  const automaticMessage = automatic?.message || (automatic?.status === "generating" ? "正在梳理资料中的概念与关系。"
    : automatic?.status === "error" ? "可以重试，已整理的内容会保留。"
    : automatic?.status === "empty" ? "可重新生成，并从资料中恢复概念。"
    : automatic?.status === "waiting-model" ? "选择用于整理资料的模型，即可开始。"
    : automatic?.status === "waiting-source" ? "资料文字提取完成后，将自动生成图谱。"
    : "从资料中提炼概念与关系，并保留它们的来源。");
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      setMeasured(true);
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const topology = concepts
    .map((c) => `${c.id}:${c.links.join(",")}`)
    .join(";");
  const previousFrame = useRef({
    width: rememberedView.current?.width || size.width,
    height: rememberedView.current?.height || size.height,
    topology,
    count: concepts.length,
    spread, mode, rootId, sourceFilter, orphans,
    initialized: Boolean(rememberedView.current?.mode),
  });
  useEffect(() => {
    if (!measured || size.width <= 0 || size.height <= 0) return;
    const previous = previousFrame.current;
    const changedLayout = previous.mode !== mode || previous.rootId !== rootId || previous.spread !== spread;
    const changedFilter = previous.sourceFilter !== sourceFilter || previous.orphans !== orphans;
    if (!previous.initialized || compact || changedLayout || changedFilter || (autoFit.current && previous.topology !== topology)) {
      autoFit.current = true;
      setCamera(readingGraphCamera(nodes.filter((node) => shownIds.has(node.id)), size.width, size.height, fitOptions, rootId));
    } else if (previous.width !== size.width || previous.height !== size.height) {
      if (autoFit.current) setCamera(readingGraphCamera(nodes.filter((node) => shownIds.has(node.id)), size.width, size.height, fitOptions, rootId));
      else setCamera((camera) => resizeGraphCamera(camera, previous, size));
    }
    previousFrame.current = { ...size, topology, count: concepts.length, spread, mode, rootId, sourceFilter, orphans, initialized: true };
  }, [topology, size.width, size.height, compact, spread, measured, mode, rootId, sourceFilter, orphans]);
  useEffect(() => {
    if (viewKey && measured && size.width > 0 && size.height > 0) graphViews.set(viewKey, {
      camera, ...size, mode, rootId, expanded, all, relaxFocus, focusBase, geometrySignature, localPins, autoFit: autoFit.current, selected: active?.id || null, detailOpen: Boolean(active && detailOpen), local: Boolean(active && local), depth,
      sourceFilter: filterAvailable ? sourceFilter : "", spread, arrows, orphans,
      inspectorScrollTop: inspectorPosition.current.id === active?.id ? inspectorPosition.current.top : 0,
      history,
    });
  }, [viewKey, camera, size.width, size.height, active?.id, detailOpen, local, depth, sourceFilter, filterAvailable, spread, arrows, orphans, measured, mode, rootId, expanded, all, relaxFocus, focusBase, geometrySignature, localPins, history]);
  useEffect(() => {
    const el = svg.current;
    if (!el || compact) return;
    const wheel = (event: WheelEvent) => {
      if (gesture.current) { event.preventDefault(); return; }
      if (inline && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      autoFit.current = false;
      const rect = el.getBoundingClientRect(),
        x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      setCamera((prev) => zoomGraphCamera(prev, Math.exp(-event.deltaY * 0.002), x, y));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [compact, inline]);
  const zoom = (factor: number) => {
    autoFit.current = false;
    setCamera((prev) => zoomGraphCamera(prev, factor, size.width / 2, size.height / 2));
  };
  function rememberLocation() {
    if (compact || editing || gesture.current) return;
    const location: GraphLocation = {
      camera: { ...cameraRef.current }, ...size, selected, detailOpen, local, depth,
      sourceFilter, spread, arrows, orphans, mode, rootId, expanded: [...expanded], all,
      autoFit: autoFit.current, relaxFocus, focusBase, geometrySignature, localPins,
      inspectorScrollTop: inspectorPosition.current.id === selected ? inspectorPosition.current.top : 0,
    };
    setHistory((current) => [...current.slice(-11), location]);
  }
  function goBack() {
    const location = history.at(-1);
    if (!location || editing || gesture.current) return;
    if (location.geometrySignature !== geometrySignature) { setHistory([]); return; }
    setHistory((current) => current.slice(0, -1));
    setMode(location.mode); setRootId(location.rootId); setExpanded(location.expanded); setAll(location.all);
    setSelected(location.selected); setDetailOpen(location.detailOpen); setLocal(location.local); setDepth(location.depth);
    setSourceFilter(location.sourceFilter); setSpread(location.spread); setArrows(location.arrows); setOrphans(location.orphans);
    setRelaxFocus(location.relaxFocus); setFocusBase(location.focusBase); setHovered(null); setQuery("");
    setDragPositions({}); positionsRef.current = {}; editOrigin.current = null;
    inspectorPosition.current = { id: location.selected, top: location.inspectorScrollTop };
    autoFit.current = location.autoFit;
    // Restoration owns this frame. Layout/filter effects must not refit it.
    previousFrame.current = { ...size, topology, count: concepts.length, spread: location.spread,
      mode: location.mode, rootId: location.rootId, sourceFilter: location.sourceFilter,
      orphans: location.orphans, initialized: true };
    setCamera(resizeGraphCamera(location.camera, location, size));
    if (!location.detailOpen) focusCanvas();
  }
  const previousLocation = history.at(-1);
  const previousName = previousLocation?.selected ? concepts.find((c) => c.id === previousLocation.selected)?.name : undefined;
  const backTitle = `返回${previousName ? `「${previousName}」` : "之前的图谱视图"} · Alt + ←`;
  function focus(id: string, center = false, inspect = false) {
    if (compact) {
      onOpen?.();
      return;
    }
    const node = byId.get(id), currentCamera = cameraRef.current;
    const centeredCamera = center && node ? {
      k: Math.max(readableGraphScale, currentCamera.k),
      x: (size.width > 650 && inspect ? (size.width - 280) / 2 : size.width / 2) - (node.x + (node.bounds.left + node.bounds.right) / 2) * Math.max(readableGraphScale, currentCamera.k),
      y: size.height / 2 - node.y * Math.max(readableGraphScale, currentCamera.k),
    } : null;
    const cameraChanged = centeredCamera && (Math.abs(centeredCamera.x - currentCamera.x) > 1e-6 || Math.abs(centeredCamera.y - currentCamera.y) > 1e-6 || Math.abs(centeredCamera.k - currentCamera.k) > 1e-6);
    if (id !== selected || !shownIds.has(id) || cameraChanged || (center && detailOpen !== inspect)) rememberLocation();
    if (mode === "network" && id !== selected) setFocusBase(nodes.map((n) => ({ ...n })));
    setSelected(id);
    setDetailOpen(inspect);
    setEditing(false);
    editOrigin.current = null;
    setQuery("");
    if (!shownIds.has(id)) {
      const path: string[] = [];
      let parent = byId.get(id)?.parentId;
      while (parent) { path.push(parent); parent = byId.get(parent)?.parentId; }
      setExpanded((current) => [...new Set([...current, ...path])]);
      setSourceFilter(""); setOrphans(true);
      // Search deliberately leaves the filter; retain its target-centered camera.
      previousFrame.current = { ...previousFrame.current, sourceFilter: "", orphans: true };
    }
    if (centeredCamera) {
      autoFit.current = false;
      setCamera(centeredCamera);
    }
  }
  function returnToGraph() {
    rememberLocation();
    setRootId(undefined); setSourceFilter(""); setOrphans(true); setExpanded([]); setAll(true); clearFocus();
    autoFit.current = true; if (!rootId) fit(new Set(concepts.map((c) => c.id)));
  }
  function clearFocus() {
    setSelected(null); setHovered(null); setLocal(false); setDetailOpen(false); setEditing(false);
  }
  function fit(ids = shownIds) {
    autoFit.current = true;
    setCamera(fitLearningGraph(nodes.filter((n) => ids.has(n.id)), size.width - (detailVisible && !narrow ? 290 : 0), size.height, fitOptions));
  }
  function changeLayout(next: LearningLayoutMode) {
    if (mode === next) return;
    rememberLocation();
    setSelected(null); setHovered(null); setFocusBase(null);
    setMode(next); setLocal(false); setAll(next !== "core");
    setExpanded([]); setDetailOpen(false);
    autoFit.current = true;
  }
  function toggleBranch(id: string) {
    autoFit.current = false;
    setExpanded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  function collapseToBackbone() {
    rememberLocation();
    setAll(false); setExpanded([]); setSelected(null); setHovered(null); setDetailOpen(false);
    const ids = new Set(learningGraph.roots);
    learningGraph.nodes.filter((n) => n.isRoot).forEach((n) => n.childIds.slice(0, 5).forEach((id) => ids.add(id)));
    autoFit.current = true;
    setCamera(readingGraphCamera(nodes.filter((n) => ids.has(n.id)), size.width, size.height, fitOptions, rootId));
  }
  function unfoldAll() {
    rememberLocation();
    setAll(true);
    fit(new Set(concepts.filter((c) => (!sourceFilter || c.anchors?.some((a) => a.sourceId === sourceFilter)) && (orphans || network.neighbors.get(c.id)!.size > 0)).map((c) => c.id)));
  }
  function edit(node?: Concept) {
    editOrigin.current = { selected, detailOpen };
    setSelected(node?.id || null);
    setName(node?.name || "");
    setDescription(node?.description || "");
    setLinks(node?.links || []);
    setEditing(true);
    setDetailOpen(true);
  }
  function focusCanvas() {
    requestAnimationFrame(() => svg.current?.focus({ preventScroll: true }));
  }
  function cancelEdit() {
    const previous = editOrigin.current;
    setEditing(false);
    setSelected(previous?.selected || null);
    setDetailOpen(Boolean(previous?.detailOpen && previous.selected));
    editOrigin.current = null;
    if (!previous?.detailOpen || !previous.selected) focusCanvas();
  }
  function closeDetail() {
    if (editing && editOrigin.current) setSelected(editOrigin.current.selected);
    editOrigin.current = null;
    setEditing(false);
    setDetailOpen(false);
    setHovered(null);
    focusCanvas();
  }
  function save() {
    if (!name.trim()) return;
    const node: Concept = {
      ...active,
      id: active?.id || crypto.randomUUID(),
      name: name.trim(),
      description,
      links,
      x: active?.x ?? 50,
      y: active?.y ?? 50,
      group: active?.group ?? 0,
    };
    onChange?.(
      active
        ? concepts.map((c) => (c.id === active.id ? node : c))
        : [...concepts, node],
    );
    setEditing(false);
    setSelected(node.id);
    setDetailOpen(true);
    editOrigin.current = null;
  }
  function begin(event: React.PointerEvent, id?: string) {
    if (compact || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.stopPropagation();
    svg.current?.focus({ preventScroll: true });
    suppressClick.current = false;
    gesture.current = {
      id,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      initialPositions: positionsRef.current,
      initialNode: id ? byId.get(id) : undefined,
      initialCamera: cameraRef.current,
      initialAutoFit: autoFit.current,
      outside: false,
    };
    svg.current?.setPointerCapture(event.pointerId);
  }
  function outsideCanvas(x: number, y: number) {
    const bounds = svg.current?.getBoundingClientRect();
    return !bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  }
  function findDropTarget(x: number, y: number) {
    return conceptDropTarget(projectId,x,y,svg.current);
  }
  function markDropTarget(target: HTMLElement | null) {
    dropTarget.current = markConceptDropTarget(dropTarget.current,target);
  }
  function restorePositions(g: NonNullable<typeof gesture.current>) {
    positionsRef.current = g.initialPositions;
    setDragPositions(g.initialPositions);
  }
  function move(event: React.PointerEvent) {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    const dx = event.clientX - g.x,
      dy = event.clientY - g.y;
    g.x = event.clientX;
    g.y = event.clientY;
    if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > 4)
      g.moved = true;
    if (!g.moved) return;
    if (g.id) {
      const outside = outsideCanvas(event.clientX, event.clientY);
      const target = findDropTarget(event.clientX, event.clientY);
      // A floating conversation can overlap the graph's rectangle. Hit-testing
      // the visible target takes precedence over that rectangle's bounds.
      if (outside || target) {
        if (!g.outside) restorePositions(g);
        g.outside = true;
        markDropTarget(target);
        if (projectId) setTransferPreview({ id: g.id, x: event.clientX, y: event.clientY, canDrop: Boolean(target) });
        return;
      }
      g.outside = false;
      markDropTarget(null);
      setTransferPreview(null);
      const node = g.initialNode;
      if (node && mode === "network") {
        const next = {
          ...g.initialPositions,
          [g.id]: {
            x: node.x + (event.clientX - g.startX) / g.initialCamera.k,
            y: node.y + (event.clientY - g.startY) / g.initialCamera.k,
          },
        };
        positionsRef.current = next;
        setDragPositions(next);
      }
    } else { autoFit.current = false; setCamera((p) => ({ ...p, x: p.x + dx, y: p.y + dy })); }
  }
  function end(event?: React.PointerEvent, cancelled = false) {
    const g = gesture.current;
    if (!g || (event && g.pointer !== event.pointerId)) return;
    // Pointerup may carry a newer position than the final coalesced move.
    if (event && !cancelled) move(event);
    gesture.current = null;
    if (svg.current?.hasPointerCapture(g.pointer)) svg.current.releasePointerCapture(g.pointer);
    markDropTarget(null);
    setTransferPreview(null);
    suppressClick.current = g.moved || cancelled;
    if (cancelled) {
      autoFit.current = g.initialAutoFit;
      if (g.id) restorePositions(g);
      else setCamera(g.initialCamera);
      return;
    }
    if (g.id && g.moved) {
      const x = event?.clientX ?? g.x, y = event?.clientY ?? g.y;
      const target = findDropTarget(x, y);
      if (target || outsideCanvas(x, y)) {
        restorePositions(g);
        if (projectId) deliverConceptDrop(target,projectId,g.id);
        return;
      }
      const position = positionsRef.current[g.id];
      if (position && mode === "network") {
        // A manual drop becomes input to collision handling, never an overlay
        // that silently defeats the focused layout's label avoidance.
        setHistory([]);
        if (!onChange) setLocalPins((current) => ({ ...current, [g.id!]: position }));
        setFocusBase(null); setSelected(null); setHovered(null); setDetailOpen(false);
        setDragPositions({}); positionsRef.current = {};
        onChange?.(concepts.map((c) => c.id === g.id ? { ...c, layout: position } : c));
      }
    } else if (g.id) focus(g.id);
    else if (!g.moved) {
      setSelected(null);
      setEditing(false);
      setLocal(false);
      setDetailOpen(false);
    }
  }
  return (
    <div data-layout={mode} data-relation-kind={relationKind} style={{ "--graph-menu-height": `${Math.max(90, size.height - 12)}px` } as CSSProperties} className={`network-workbench ${inline ? "is-inline" : ""} ${compact ? "is-compact" : ""} ${narrow ? "is-narrow" : ""} ${fullDetail ? "has-full-detail" : ""}`}
      onKeyDownCapture={(event) => {
        if (event.key !== "ArrowLeft" || !event.altKey || event.metaKey || event.ctrlKey || editing || gesture.current || !history.length) return;
        if ((event.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault(); event.stopPropagation(); goBack();
      }}>
      {!compact && !automaticEmpty && (
        <header className="network-toolbar" inert={fullDetail} aria-hidden={fullDetail || undefined}>
          {history.length > 0 && !fullDetail && <button className="network-icon network-history-back" aria-label="返回上一个图谱视图" title={backTitle} disabled={editing} onClick={goBack}><ArrowLeft size={16}/></button>}
          <div className="network-search">
            <Search size={15} />
            <input
              aria-label="搜索图谱概念"
              placeholder="搜索概念…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) focus(results[0].id, true);
                if (e.key === "Escape") setQuery("");
              }}
            />
            {query && (
              <button aria-label="清除图谱搜索" onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            )}
            {query && (
              <div className="network-search-results">
                {results.length ? (
                  results.map((c) => (
                    <button key={c.id} onClick={() => focus(c.id, true)}>
                      <span>{c.name}</span>
                      <small>{network.neighbors.get(c.id)?.size} 个关联</small>
                    </button>
                  ))
                ) : (
                  <p>未找到匹配概念</p>
                )}
              </div>
            )}
          </div>
          {(rootId || local || sourceFilter || !orphans) && <button className="network-return" aria-label="返回完整图谱" title="清除局部范围与筛选，返回全图" onClick={returnToGraph}><ArrowLeft size={12}/>全图</button>}
          <ActionMenu className="network-layout-menu" label={`展开方式：${layoutChoices.find((choice) => choice.value === mode)!.label}`} trigger={<><span>{layoutChoices.find((choice) => choice.value === mode)!.label}</span><ChevronDown size={13}/></>}>
            <span className="action-menu-label">展开方式</span>
            {layoutChoices.map((choice) => <button key={choice.value} aria-pressed={mode === choice.value} onClick={() => changeLayout(choice.value)}>
              <span><strong>{choice.label}</strong><small>{choice.description}</small></span>{mode === choice.value && <Check size={14}/>}
            </button>)}
            <hr className="action-menu-divider"/>
            {mode === "core" && !local && <button onClick={() => {
              if (all || expanded.length) collapseToBackbone(); else unfoldAll();
            }}>{all || expanded.length ? "收起到主干" : `展开全部 ${concepts.length}`}</button>}
            <details className="network-menu-options" data-menu-keep-open>
              <summary>显示设置</summary>
                <label>
                  节点间距
                  <input
                    type="range"
                    min="70"
                    max="300"
                    step="10"
                    value={spread}
                    onChange={(e) => {
                      setHistory([]);
                      setDragPositions({}); setFocusBase(null); setSelected(null); setHovered(null); setDetailOpen(false);
                      setSpread(Number(e.target.value));
                    }}
                  />
                </label>
                {relationKind === "prerequisite" && <label>
                  <span>显示先修到扩展方向</span>
                  <input
                    type="checkbox"
                    checked={arrows}
                    onChange={(e) => setArrows(e.target.checked)}
                  />
                </label>}
                <label>
                  <span>显示独立概念</span>
                  <input
                    type="checkbox"
                    checked={orphans}
                    onChange={(e) => { rememberLocation(); setOrphans(e.target.checked); }}
                  />
                </label>
                {sourceOptions.length > 0 && (
                  <label>
                    原文来源
                    <select
                      aria-label="筛选图谱原文来源"
                      value={sourceFilter}
                      onChange={(e) => { rememberLocation(); setSourceFilter(e.target.value); }}
                    >
                      <option value="">全部来源</option>
                      {sourceOptions.map(([id, title]) => (
                        <option key={id} value={id}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="network-reset"
                  onClick={() => {
                    setHistory([]);
                    setDragPositions({}); setLocalPins({}); setFocusBase(null); setSelected(null); setHovered(null); setDetailOpen(false);
                    setSpread(150);
                    const reset = mode === "network" ? concepts.map(({ layout: _, ...c }) => c) : concepts;
                    if (mode === "network") onChange?.(reset);
                    setCamera(
                      fitLearningGraph(buildLearningGraph(reset, { mode, relationKind, rootId }).nodes.filter((n) => shownIds.has(n.id)), size.width, size.height, fitOptions),
                    );
                  }}
                >
                  <RotateCcw size={14} />
                  恢复自动布局
                </button>
            </details>
            {(automatic?.onRetry || onChange || coverageMessage || sparseMessage) && <details className="network-menu-options">
              <summary>图谱内容</summary>
              {(coverageMessage || sparseMessage) && <p>{[coverageMessage, sparseMessage].filter(Boolean).join(" · ")}</p>}
              {automatic?.onRetry && <button onClick={automatic.onRetry}
                disabled={automatic.busy || automatic.status === "generating" || automatic.status === "waiting-model" || automatic.status === "waiting-source"}>
                <RotateCcw size={14}/>{automatic.status === "generating" ? "正在整理图谱" : `补全${automatic.scopeLabel || ""}图谱`}
              </button>}
              {onChange && <button onClick={() => edit()}><Plus size={14}/>新增概念</button>}
            </details>}
            <p className="network-menu-help">{mode === "core" ? "点分支旁的 + 逐步展开；虚线表示跨分支关系。" : mode === "layers" ? relationKind === "prerequisite" ? "左侧先修，右侧扩展；环内不分先后。" : "由起点按关联距离分层。" : "悬停看邻居，单击关注；拖动节点可调整位置。"}<br/>双击概念查看详情；点空白或 Esc 取消关注。</p>
          </ActionMenu>
        </header>
      )}
      <div className="network-canvas" ref={root}>
        <svg
          ref={svg}
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="group"
          aria-label="可交互知识网络"
          aria-hidden={fullDetail || undefined}
          tabIndex={compact || automaticEmpty || fullDetail ? -1 : 0}
          onPointerDown={(e) => begin(e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={(event) => end(event, true)}
          onLostPointerCapture={(event) => end(event, true)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && gesture.current) {
              e.preventDefault();
              e.stopPropagation();
              end(undefined, true);
              return;
            }
            if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
            const key = e.key;
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "+",
                "-",
                "=",
                "Escape",
              ].includes(key)
            )
              e.preventDefault();
            if (key === "+" || key === "=") zoom(1.2);
            if (key === "-") zoom(1 / 1.2);
            if (key === "Escape") {
              setSelected(null);
              setEditing(false);
              setLocal(false);
              setDetailOpen(false);
            }
            if (key.startsWith("Arrow")) {
              autoFit.current = false;
              setCamera((p) => ({
                ...p,
                x:
                  p.x +
                  (key === "ArrowLeft" ? 40 : key === "ArrowRight" ? -40 : 0),
                y:
                  p.y +
                  (key === "ArrowUp" ? 40 : key === "ArrowDown" ? -40 : 0),
              }));
            }
          }}
        >
          <defs>
            <marker
              id={`${unique}-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          <g
            transform={`translate(${camera.x},${camera.y}) scale(${camera.k})`}
          >
            {shownEdges.map((edge) => {
              const related = highlightId && emphasized.has(edge.source) && emphasized.has(edge.target);
              return <path key={edge.key} d={learningEdgePath(edge, byId)}
                className={`network-edge ${mode === "core" && !edge.tree ? "is-cross" : ""} ${edge.cycle ? "is-cycle" : ""} ${related ? "is-active" : ""} ${highlightId && !related ? "is-dim" : ""}`}
                fill="none" style={{ opacity: highlightId && !related ? .16 : mode === "core" && !edge.tree ? .55 : 1, stroke: related ? "var(--green)" : "var(--graph-edge)" }} vectorEffect="non-scaling-stroke"
                markerEnd={relationKind === "prerequisite" && (arrows || mode === "layers") ? `url(#${unique}-arrow)` : undefined}/>;
            })}
            {shown.map((c) => {
              const n = byId.get(c.id)!;
              const dim = Boolean(highlightId && !emphasized.has(c.id)) || (Boolean(query) && !results.some((r) => r.id === c.id));
              const canExpand = mode === "core" && !local && !all && (n.isRoot ? n.childIds.length > 5 : n.childIds.length > 0);
              const hiddenChildren = n.isRoot && !expandedIds.has(c.id) ? Math.max(0, n.childIds.length - 5) : n.childIds.length;
              return <g key={c.id} transform={`translate(${n.x},${n.y})`}>
                <g role="button" tabIndex={compact || fullDetail ? -1 : 0} aria-label={`查看概念：${c.name}`} aria-pressed={selected === c.id}
                  data-hop={highlightId ? highlightDistances.get(c.id) : undefined}
                  style={{ opacity: dim ? .22 : highlightDistances.get(c.id) === 3 ? .65 : highlightDistances.get(c.id) === 2 ? .83 : 1 }}
                  className={`network-node ${dim ? "is-dim" : ""} ${selected === c.id ? "is-selected" : ""} ${hovered === c.id ? "is-hovered" : ""} ${n.isRoot ? "is-root" : ""}`}
                  onPointerDown={(event) => begin(event, c.id)} onMouseEnter={() => !compact && setHovered(c.id)} onMouseLeave={() => setHovered(null)}
                  onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) focus(c.id); suppressClick.current = false; }}
                  onDoubleClick={(event) => { event.stopPropagation(); focus(c.id, false, true); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(c.id, true, true); } }}>
                  <rect className="network-node-hit" x={n.bounds.left - 5} y={n.bounds.top - 5} width={n.label.x + n.label.width - n.bounds.left + 10} height={n.bounds.bottom - n.bounds.top + 10}/>
                  <circle className="network-node-ring" r={n.r + 5}/><circle className="network-node-core" r={n.r}/>
                  <text x={n.label.x} y={n.label.y + n.label.fontSize} style={{ fontSize: n.label.fontSize }} textAnchor="start" className={n.isRoot ? "is-hub" : undefined}>
                    {n.label.lines.map((line, index) => <tspan key={index} x={n.label.x} dy={index ? n.label.lineHeight : 0}>{line}</tspan>)}
                  </text>
                  <title>{`${c.name} · ${n.degree} 个关联${n.isRoot ? " · 展开起点" : ""}${mode === "network" && c.layout ? " · 已固定" : ""}`}</title>
                </g>
                {canExpand && <g role="button" className="network-branch-toggle" tabIndex={fullDetail ? -1 : 0}
                  aria-label={`${expandedIds.has(c.id) ? "收起" : "展开"}${c.name}的 ${hiddenChildren} 个分支`} aria-expanded={expandedIds.has(c.id)}
                  transform={`translate(${n.label.x + n.label.width + 15},0)`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); toggleBranch(c.id); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); toggleBranch(c.id); } }}>
                  <rect x={-13} y={-14} width={28} height={28} rx={4}/>
                  <text textAnchor="middle" y={4}>{expandedIds.has(c.id) ? "−" : `+${hiddenChildren}`}</text>
                </g>}
              </g>;
            })}
          </g>
        </svg>
        <GraphMinimap nodes={nodes.filter((n) => shownIds.has(n.id))} camera={camera} width={size.width} height={size.height}
          hidden={compact || detailVisible} onNavigate={(x, y) => { autoFit.current = false; setCamera((current) => ({ ...current, x: size.width / 2 - x * current.k, y: size.height / 2 - y * current.k })); }}/>
        {automaticEmpty ? (
          <div className={`network-empty network-automatic-empty is-${automatic.status}`} role="status" aria-live="polite">
            <span className={`network-empty-symbol${automatic.status === "generating" ? " network-generation-spinner" : ""}`} aria-hidden="true">
              {automatic.status === "generating" ? <LoaderCircle size={28} />
                : automatic.status === "error" ? <CircleAlert size={28} /> : <Network size={28} />}
            </span>
            <h3>{automaticTitle}</h3>
            <p>{automaticMessage}</p>
            {(automatic.status === "error" || automatic.status === "empty") && automatic.onRetry && <button className="button" onClick={automatic.onRetry} disabled={automatic.busy} title={automatic.busy ? "另一张图谱正在整理，完成后可重试" : undefined}><RotateCcw size={14} aria-hidden="true" />重新生成</button>}
            {automatic.status === "waiting-model" && automatic.onSettings && <button className="button" onClick={automatic.onSettings}><SlidersHorizontal size={14} aria-hidden="true" />配置模型</button>}
          </div>
        ) : concepts.length === 0 && (
          <div className="network-empty" inert={fullDetail} aria-hidden={fullDetail || undefined}>
            <Network size={32} />
            <h3>让知识之间的关系显现</h3>
            <p>从深度研究生成图谱，或添加第一个概念。</p>
            {onChange && (
              <button className="button" onClick={() => edit()}>
                <Plus size={14} />
                添加概念
              </button>
            )}
          </div>
        )}
        {concepts.length > 0 && automatic && (automatic.status === "generating" || automatic.status === "error") && (
          <div className={`network-generation-status is-${automatic.status}`} inert={fullDetail} aria-hidden={fullDetail || undefined} role="status" aria-live="polite" title={automaticMessage}>
            <span className={`network-generation-symbol${automatic.status === "generating" ? " network-generation-spinner" : ""}`} aria-hidden="true">
              {automatic.status === "generating" ? <LoaderCircle size={13} /> : <CircleAlert size={13} />}
            </span>
            <span>{automatic.status === "generating" ? "正在更新图谱" : "图谱更新未完成"}</span>
            {automatic.status === "error" && automatic.onRetry && <button onClick={automatic.onRetry} disabled={automatic.busy} title={automatic.busy ? "另一张图谱正在整理，完成后可重试" : undefined} aria-label="重试更新知识图谱">重试</button>}
          </div>
        )}
        {!compact && shown.length === 0 && concepts.length > 0 && (
          <div className="network-empty" inert={fullDetail} aria-hidden={fullDetail || undefined}>
            <p>当前筛选下没有概念</p>
            <button
              className="button"
              onClick={() => {
                setSourceFilter("");
                setOrphans(true);
                setLocal(false);
              }}
            >
              重置筛选
            </button>
          </div>
        )}
        {!compact && !automaticEmpty && (
          <>
            {detailVisible && (
              <aside className="network-inspector" aria-label={editing ? "编辑概念" : "概念详情"} ref={inspector} onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                if (editing) cancelEdit();
                else closeDetail();
              }} onScroll={(event) => {
                if (editing || !active) return;
                const top = event.currentTarget.scrollTop;
                inspectorPosition.current = { id: active.id, top };
                const saved = viewKey ? graphViews.get(viewKey) : undefined;
                if (viewKey && saved?.selected === active.id) graphViews.set(viewKey, { ...saved, inspectorScrollTop: top });
              }}>
                <header>
                  {fullDetail ? <>
                    {history.length > 0 && !editing ? <>
                      <button className="network-detail-back network-history-detail" data-graph-return aria-label="返回上一个图谱视图" title={backTitle} onClick={goBack}><ArrowLeft size={16}/><span>{previousName || "返回图谱"}</span></button>
                      <button aria-label="关闭概念详情" title="返回当前图谱" onClick={closeDetail}><X size={17}/></button>
                    </> : <>
                      <button className="network-detail-back" data-graph-return onClick={closeDetail} title={editing ? "放弃未保存编辑并返回图谱" : "返回图谱"}><ArrowLeft size={16}/>返回图谱</button>
                      <span>{editing ? "编辑概念" : "概念详情"}</span>
                    </>}
                  </> : <>
                    <span>{editing ? "编辑概念" : "概念详情"}</span>
                    <button aria-label={editing ? "取消编辑" : "关闭概念详情"} onClick={editing ? cancelEdit : closeDetail}><X size={17} /></button>
                  </>}
                </header>
                {editing ? (
                  <div className="network-editor">
                    <label>
                      概念名称
                      <input
                        autoFocus
                        value={name}
                        maxLength={60}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <label>
                      概念说明
                      <textarea
                        rows={4}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </label>
                    <label>关联概念</label>
                    <div className="network-link-options">
                      {concepts
                        .filter((c) => c.id !== active?.id)
                        .map((c) => (
                          <label key={c.id}>
                            <input
                              type="checkbox"
                              checked={links.includes(c.id)}
                              onChange={(e) =>
                                setLinks(
                                  e.target.checked
                                    ? [...links, c.id]
                                    : links.filter((id) => id !== c.id),
                                )
                              }
                            />
                            {c.name}
                          </label>
                        ))}
                    </div>
                    <div className="network-editor-actions">
                      <button className="button primary" disabled={!name.trim()} onClick={save}><Check size={14} />保存概念</button>
                      <button className="button" onClick={cancelEdit}>取消</button>
                    </div>
                  </div>
                ) : (
                  active && (
                    <>
                      <h2>{active.name}</h2>
                      <p>
                        {active.description ||
                          "添加说明，记录这个概念的定义与用途。"}
                      </p>
                      {mode === "network" && active.layout && (
                        <small className="network-pinned">
                          <Pin size={12} />
                          位置已固定
                        </small>
                      )}
                      <div className="network-inspector-actions">
                        {(projectId || onReferenceConcept) && (
                          <button
                            className="button small network-reference"
                            draggable={Boolean(projectId)}
                            title="拖到对话输入区，或点击引用到对话"
                            onDragStart={(event) => {
                              if (!projectId) return;
                              nativeDragAt.current = Date.now();
                              event.dataTransfer.effectAllowed = "copy";
                              event.dataTransfer.setData("application/x-sidereader-object", JSON.stringify({ version: 1, projectId, kind: "concept", conceptId: active.id }));
                              event.dataTransfer.setData("application/x-sidereader-concept", "1");
                              event.dataTransfer.setData("text/plain", active.name);
                            }}
                            onDragEnd={() => { nativeDragAt.current = Date.now(); }}
                            onClick={() => {
                              if (Date.now() - nativeDragAt.current > 250) onReferenceConcept?.(active.id);
                            }}
                          >
                            <MessageSquarePlus size={13} />引用到对话
                          </button>
                        )}
                        <button className="button small" onClick={() => {
                          rememberLocation();
                          const next = !local; setLocal(next); if (!next) { setAll(true); setSourceFilter(""); setOrphans(true); } fit(next ? new Set(concepts.filter((c) => localIds.has(c.id) && (!sourceFilter || c.anchors?.some((a) => a.sourceId === sourceFilter)) && (orphans || network.neighbors.get(c.id)!.size > 0)).map((c) => c.id)) : new Set(nodes.map((n) => n.id))); if (narrow) closeDetail();
                        }}>{local ? "查看全部概念" : "只看关联"}</button>
                        <button className="button small" onClick={() => {
                          rememberLocation();
                          setRootId(active.id); setMode("core"); setLocal(false); setAll(false); setExpanded([]); closeDetail();
                        }}>以此展开</button>
                        {onChange && (
                          <button
                            className="button small"
                            onClick={() => edit(active)}
                          >
                            <Pencil size={13} />
                            编辑
                          </button>
                        )}
                      </div>
                      <GraphRelations concepts={concepts} activeId={active.id} relationKind={relationKind} onSelect={(id) => focus(id, true, true)}/>
                      <section>
                        <h3>原文依据</h3>
                        {active.anchors?.length ? (
                          active.anchors.map((a, i) => (
                            <button
                              className="network-source"
                              key={i}
                              onClick={() => onReadAnchor?.(a)}
                            >
                              <span>
                                {a.title}
                                <small>第 {a.page} 页</small>
                              </span>
                              <ArrowUpRight size={14} />
                            </button>
                          ))
                        ) : (
                          <p>尚未关联原文</p>
                        )}
                      </section>
                      {onChange && (
                        <button
                          className="network-delete"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `删除「${active.name}」及其关联连线？此操作无法撤销，原资料会保留。`,
                              )
                            )
                              return;
                            onChange(
                              concepts
                                .filter((c) => c.id !== active.id)
                                .map((c) => ({
                                  ...c,
                                  links: c.links.filter(
                                    (id) => id !== active.id,
                                  ),
                                })),
                            );
                            setSelected(null);
                            setLocal(false);
                            setDetailOpen(false);
                            focusCanvas();
                          }}
                        >
                          <Trash2 size={13} />
                          删除概念
                        </button>
                      )}
                    </>
                  )
                )}
              </aside>
            )}
          </>
        )}
      </div>
      {!compact && !automaticEmpty && <footer className="network-footer" inert={fullDetail} aria-hidden={fullDetail || undefined}>
        <div className="network-footer-context">
          {active && shownIds.has(active.id) ? <>
            <button className="network-focus-name" aria-label={`查看 ${active.name} 的详情`} aria-expanded={detailOpen}
              title={`${active.name} · 查看详情`} onClick={() => detailOpen ? closeDetail() : setDetailOpen(true)}>
              <span className="network-focus-dot" aria-hidden="true"/><span className="network-focus-title">{active.name}</span><span className="network-focus-short">详情</span><ChevronRight size={12}/>
            </button>
            <ActionMenu className="network-focus-menu" label="关联范围与关注设置" placement="top" align="start" trigger={<><span>关联 · {depth}级</span><ChevronDown size={11}/></>}>
              <span className="action-menu-label">高亮几级关联</span>
              <div className="network-depth-options" data-menu-keep-open role="group" aria-label="高亮关联层数">
                {[1, 2, 3].map((level) => <button key={level} aria-label={`高亮${level}级关联`} aria-pressed={depth === level} onClick={() => setDepth(level)}>{level} 级</button>)}
              </div>
              {mode === "network" && <label className="network-menu-toggle" data-menu-keep-open><span>自动舒展拥挤处</span><input type="checkbox" aria-label="自动舒展拥挤处" checked={relaxFocus} onChange={(event) => setRelaxFocus(event.target.checked)}/></label>}
              <hr className="action-menu-divider"/>
              <button onClick={clearFocus}>取消关注 <small>Esc</small></button>
            </ActionMenu>
          </> : <span className="network-status" title={`${shownEdges.length} 条关联`}>
            {shown.length}{shown.length < concepts.length ? ` / ${concepts.length}` : ""} 个概念<span className="network-edge-count"> · {shownEdges.length} 条关联</span>
          </span>}
        </div>
        <div className="network-footer-actions">
          <ActionMenu className="network-scale-menu" label="图谱缩放" placement="top" trigger={<><span>{Math.round(camera.k * 100)}%</span><ChevronDown size={11}/></>}>
            <div className="menu-zoom-row" data-menu-keep-open>
              <button aria-label="缩小图谱" onClick={() => zoom(1 / 1.2)}><Minus size={16}/></button>
              <span>{Math.round(camera.k * 100)}%</span>
              <button aria-label="放大图谱" onClick={() => zoom(1.2)}><Plus size={16}/></button>
            </div>
            <button aria-label="按原字号查看图谱" onClick={() => zoom(1 / camera.k)}>恢复 100%</button>
            <p className="network-menu-help">{inline ? "⌘/Ctrl + 滚轮缩放" : "滚轮缩放 · 拖动空白平移"}</p>
          </ActionMenu>
          <button className="network-icon" aria-label="适应图谱大小" title="适应窗口" onClick={() => fit()}><Maximize size={15}/></button>
          {onAskGraph && <button className="network-ask" aria-label="追问这个图谱" onClick={onAskGraph}><MessageSquarePlus size={14}/><span>追问</span></button>}
        </div>
      </footer>}
      {transferPreview && createPortal(
        <div
          className={`network-concept-transfer${transferPreview.canDrop ? " can-drop" : ""}`}
          style={{ left: Math.max(8, Math.min(transferPreview.x + 16, window.innerWidth - 244)), top: Math.max(8, Math.min(transferPreview.y + 16, window.innerHeight - 70)) }}
          role="status"
        >
          <Network size={16} aria-hidden="true" />
          <span><strong>{concepts.find((concept) => concept.id === transferPreview.id)?.name}</strong><small>{transferPreview.canDrop ? "松开，引用到对话" : "拖到对话输入区"}</small></span>
        </div>, document.body,
      )}
    </div>
  );
}
