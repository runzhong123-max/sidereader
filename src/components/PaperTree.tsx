import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { BookOpen, ChevronRight, FileQuestion, FolderOpen, List, MessageSquare, Network, PanelRightOpen, Plus, Search, Upload, X } from "lucide-react";
import type { PaperNode, Project, WorkspaceTab } from "../types";
import { nodeTitle } from "../paper-tree-state.mjs";
import { conversationQuestionPreview, conversationSearchMatch, conversationSummary, projectNavigationId, projectNavigationNodes, type ConversationSummary } from "../conversation-model.mjs";
import { writeWorkspaceTransfer } from "../object-transfer.mjs";
import { createWorkspacePointerTransfer, WORKSPACE_POINTER_EVENT, type WorkspacePointerTransfer } from "../workspace-pointer-transfer.mjs";
import { parentChain } from "../domain/relations.mjs";
import { projectReadingRoot, scopeAttachments } from "../reading-scope-navigation.mjs";
import { practiceCatalog, type PracticeEntry } from "../practice-catalog.mjs";
import "../paper-tree.css";
import { persistenceKeys } from "../persistence/keys.mjs";
import { localPreferences } from "../persistence/preferences.mjs";

type PaperTreeProps = {
  project: Project;
  activeId: string;
  secondaryId?: string;
  onOpen: (tab: WorkspaceTab) => void;
  onOpenSearch?: (tab: WorkspaceTab, messageId?: string) => void;
  onNewBranch: (parentId: string) => void;
  onImport: () => void;
  onManageSources: () => void;
  onCompare?: (tab: WorkspaceTab) => void;
  onOpenScopeGraph?: (parentId: string) => void;
  onOpenObject?: (tab: WorkspaceTab) => void;
  onOpenPractice?: (entry: PracticeEntry) => void;
};

type TreeEntry = {
  id: string;
  parentId: string | null;
  label: string;
  typeLabel: string;
  icon: typeof BookOpen;
  node?: PaperNode;
  children: string[];
  defaultExpanded?: boolean;
  group?: "conversations" | "materials";
  summary?: ConversationSummary;
  material?: { questionCount?: number; practiceEntry?: PracticeEntry; graphScopeId?: string };
};
type Expansion = Record<string, Record<string, boolean>>;

function readExpansion(): Expansion {
  try {
    const value = localPreferences.getJSON<unknown>(persistenceKeys.treeExpansion, {});
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Record<string, boolean>] =>
      !!entry[1] && typeof entry[1] === "object" && !Array.isArray(entry[1]) && Object.values(entry[1]).every((expanded) => typeof expanded === "boolean"),
    ));
  } catch { return {}; }
}

// Project navigation keeps PDF outlines and independent conversation entries.
// Derived papers stay inside their conversation; materials have a separate group.
export function buildPaperTree(project: Project) {
  const nodes = projectNavigationNodes(project);
  const projectNode = projectReadingRoot(project);
  const entries = new Map<string, TreeEntry>();
  for (const node of nodes) entries.set(node.id, {
    id: node.id, parentId: node.parentId || null, node, children: [],
    label: node.id === projectNode?.id ? project.name || nodeTitle(project, node) : nodeTitle(project, node), typeLabel: node.id === projectNode?.id ? "项目" : node.role === "chapter" ? "章节" : node.kind === "book" ? project.sources.find((source) => source.id === node.sourceId)?.kind === "pdf" ? "PDF" : "资料" : "主对话",
    icon: node.role === "chapter" ? List : node.kind === "book" ? BookOpen : MessageSquare,
    defaultExpanded: node.id === projectNode?.id,
    summary: node.kind === "chat" ? conversationSummary(project, node.id) : undefined,
  });
  const roots: string[] = [];
  for (const entry of entries.values()) {
    const parent = entry.parentId ? entries.get(entry.parentId) : undefined;
    if (parent) parent.children.push(entry.id);
    else { entry.parentId = null; roots.push(entry.id); }
  }
  const practice = practiceCatalog(project);
  const scopeIds = new Set<string>();
  for (const scope of [...entries.values()]) {
    const conversationIds = scope.children.filter((id) => entries.get(id)?.node?.kind === "chat");
    if (conversationIds.length) {
      const id = `navigation:conversations:${encodeURIComponent(scope.id)}`;
      conversationIds.sort((a, b) => {
        const first = entries.get(a)?.summary, second = entries.get(b)?.summary;
        return Number(Boolean(second?.hasInteraction)) - Number(Boolean(first?.hasInteraction)) ||
          (second?.sortTime || 0) - (first?.sortTime || 0) || a.localeCompare(b);
      });
      entries.set(id, { id, parentId: scope.id, label: "主对话", typeLabel: "对话分组", icon: MessageSquare, group: "conversations", children: conversationIds });
      for (const childId of conversationIds) entries.get(childId)!.parentId = id;
      scope.children = [...scope.children.filter((childId) => !conversationIds.includes(childId)), id];
    }
    if (scope.node?.role !== "chapter" && scope.id !== projectNode?.id) continue;
    scopeIds.add(scope.id);
    const cards = scopeAttachments(project, scope.id, practice);
    const materials: TreeEntry[] = [];
    materials.push({ id: cards.graph.id, parentId: null, label: "知识图谱", typeLabel: "图谱", icon: Network, node: cards.graph,
      material: { graphScopeId: cards.graphMissing ? scope.id : undefined }, children: [] });
    for (const card of cards.questions) materials.push({ id: card.node.id, parentId: null, label: card.title, typeLabel: "习题", icon: FileQuestion, node: card.node,
      material: { questionCount: card.count, practiceEntry: card.practiceEntry }, children: [] });
    if (!materials.length) continue;
    const id = `navigation:materials:${encodeURIComponent(scope.id)}`;
    entries.set(id, { id, parentId: scope.id, label: "学习材料", typeLabel: "材料分组", icon: FolderOpen, group: "materials", children: materials.map((entry) => entry.id) });
    for (const entry of materials) entries.set(entry.id, { ...entry, parentId: id });
    scope.children.push(id);
  }
  return { entries, roots, scopeIds };
}

function activityLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : date.toLocaleDateString("zh-CN", { ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" as const } : {}), month: "numeric", day: "numeric" });
}

function ancestorEntries(entries: Map<string, TreeEntry>, id: string) {
  return parentChain(entries, id).slice(1).reverse().map((entry) => entry.id);
}

function revealTreeElement(row?: HTMLElement | null) {
  const scroller = row?.closest<HTMLElement>(".workspace-paper-scroll");
  if (!row || !scroller || !scroller.clientHeight) return;
  const rowBounds = row.getBoundingClientRect();
  const scrollBounds = scroller.getBoundingClientRect();
  // Keep all navigation scrolling inside the tree, including keyboard focus.
  if (rowBounds.top < scrollBounds.top) scroller.scrollTop += rowBounds.top - scrollBounds.top;
  else if (rowBounds.bottom > scrollBounds.bottom) scroller.scrollTop += rowBounds.bottom - scrollBounds.bottom;
}

function revealTreeRow(element?: HTMLLIElement) {
  revealTreeElement(element?.querySelector<HTMLElement>(":scope > .workspace-paper-row"));
}

export default function PaperTree({ project, activeId, secondaryId, onOpen, onOpenSearch, onNewBranch, onImport, onManageSources, onCompare, onOpenScopeGraph, onOpenObject, onOpenPractice }: PaperTreeProps) {
  const projectNode = projectReadingRoot(project);
  const navigationId = projectNavigationId(project, activeId);
  const secondaryNavigationId = secondaryId ? projectNavigationId(project, secondaryId) : undefined;
  const activeNode = project.paperTree?.nodes.find((node) => node.id === activeId);
  const secondaryNode = project.paperTree?.nodes.find((node) => node.id === secondaryId);
  // Objects reveal their source path, but do not make that PDF appear open.
  const activeIsPaper = activeNode?.kind === "book" || activeNode?.kind === "chat";
  const secondaryIsPaper = secondaryNode?.kind === "book" || secondaryNode?.kind === "chat";
  const [query, setQuery] = useState("");
  const [expansion, setExpansion] = useState(readExpansion);
  const [focusedId, setFocusedId] = useState(navigationId);
  const [selectedEntryId, setSelectedEntryId] = useState(navigationId);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const pointerTransfer = useRef<{ pointerId: number; element: HTMLDivElement; transfer: WorkspacePointerTransfer; nativeDraggable: boolean } | null>(null);
  const suppressClickUntil = useRef(0);
  const headingId = useId();
  const helpId = useId();
  const { entries, roots, scopeIds } = useMemo(() => buildPaperTree(project), [project]);
  function cancelPointerTransfer() {
    const current = pointerTransfer.current;
    pointerTransfer.current = null;
    if (!current) return;
    current.transfer.cancel();
    suppressClickUntil.current = Date.now() + 350;
    current.element.draggable = current.nativeDraggable;
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !pointerTransfer.current) return;
      event.preventDefault(); event.stopPropagation(); cancelPointerTransfer();
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancelPointerTransfer);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancelPointerTransfer);
      cancelPointerTransfer();
    };
  }, [project.id]);
  function beginPointerTransfer(event: PointerEvent<HTMLDivElement>, entry: TreeEntry) {
    // Touch retains normal outline scrolling. Native drag remains available for
    // browsers without pointer capture and for existing external drag sources.
    if (!entry.node || event.button !== 0 || event.pointerType === "touch" || !event.isPrimary ||
      (event.target as Element).closest("button, input, a") || pointerTransfer.current ||
      !event.currentTarget.setPointerCapture) return;
    const transfer = createWorkspacePointerTransfer({ projectId: project.id, nodeId: entry.node.id, kind: entry.material ? "object" : "paper" },
      { pointerId: event.pointerId, x: event.clientX, y: event.clientY },
      (update) => window.dispatchEvent(new CustomEvent(WORKSPACE_POINTER_EVENT, { detail: update })));
    if (!transfer) return;
    event.preventDefault();
    focusEntry(entry.id);
    // Disable native initiation only while this captured pointer owns the row;
    // otherwise Safari can cancel the pointer before React receives dragstart.
    const nativeDraggable = event.currentTarget.draggable;
    event.currentTarget.draggable = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerTransfer.current = { pointerId: event.pointerId, element: event.currentTarget, transfer, nativeDraggable };
  }
  function movePointerTransfer(event: PointerEvent<HTMLDivElement>) {
    const current = pointerTransfer.current;
    if (current?.transfer.move({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })) event.preventDefault();
  }
  function finishPointerTransfer(event: PointerEvent<HTMLDivElement>) {
    const current = pointerTransfer.current;
    if (!current || current.pointerId !== event.pointerId) return;
    pointerTransfer.current = null;
    if (current.transfer.finish({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })) suppressClickUntil.current = Date.now() + 350;
    current.element.draggable = current.nativeDraggable;
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }
  const selectedEntry = entries.get(selectedEntryId);
  const activeEntry = entries.get(activeId)?.material ? entries.get(activeId) : selectedEntry?.node?.id === navigationId ? selectedEntry
    : entries.get(navigationId) || [...entries.values()].find((entry) => entry.node?.id === navigationId);
  const activeEntryId = activeEntry?.id || navigationId;
  function locationPath(entryId: string, objectId?: string) { return ancestorEntries(entries, objectId && entries.has(objectId) ? objectId : entryId); }
  const activePath = locationPath(activeEntryId, activeId);
  const activePathKey = activePath.join("\u0000");
  const secondaryPathKey = secondaryNavigationId ? locationPath(secondaryNavigationId, secondaryId).join("\u0000") : "";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchMatches = new Map([...entries.values()].filter((entry) => entry.summary).map((entry) => [entry.id, conversationSearchMatch(project, entry.id, normalizedQuery)]));
  const allEntries = [...entries.values()];
  const matching = normalizedQuery ? allEntries.filter((entry) =>
    !entry.group && `${entry.label} ${entry.typeLabel} ${entry.node ? nodeTitle(project, entry.node) : ""} ${entry.summary?.searchText || ""}`.toLocaleLowerCase().includes(normalizedQuery),
  ) : [];
  const matchingIds = new Set(matching.map((entry) => entry.id));
  const includedIds = new Set<string>();
  for (const entry of matching) {
    includedIds.add(entry.id);
    for (const ancestorId of ancestorEntries(entries, entry.id)) includedIds.add(ancestorId);
  }
  function isExpanded(entry: TreeEntry) {
    return !!normalizedQuery || (expansion[project.id]?.[entry.id] ?? !!entry.defaultExpanded);
  }
  function visibleChildren(entry: TreeEntry) {
    return entry.children.filter((id) => !normalizedQuery || includedIds.has(id));
  }
  const visibleEntries: TreeEntry[] = [];
  function collect(id: string) {
    const entry = entries.get(id);
    if (!entry || (normalizedQuery && !includedIds.has(id))) return;
    visibleEntries.push(entry);
    if (isExpanded(entry)) for (const childId of visibleChildren(entry)) collect(childId);
  }
  for (const root of roots) collect(root);
  const visibleIds = visibleEntries.map((entry) => entry.id);
  const visibleRoots = roots.filter((id) => !normalizedQuery || includedIds.has(id));
  const tabStopId = visibleIds.includes(focusedId) ? focusedId : visibleIds.includes(activeEntryId) ? activeEntryId : visibleIds[0];
  const firstResult = matching.find((entry) => entry.node) || matching[0];
  const expandedPathKey = activePath.map((id) => {
    const entry = entries.get(id);
    return entry && isExpanded(entry) ? "1" : "0";
  }).join("");
  const secondaryExpandedPathKey = secondaryPathKey ? secondaryPathKey.split("\u0000").map((id) => {
    const entry = entries.get(id);
    return entry && isExpanded(entry) ? "1" : "0";
  }).join("") : "";

  useLayoutEffect(() => {
    if (expandedPathKey.includes("0")) return;
    revealTreeRow(itemRefs.current.get(activeEntryId));
  }, [project.id, activeId, activeEntryId, activePathKey, expandedPathKey]);

  useLayoutEffect(() => {
    if (!secondaryNavigationId || secondaryExpandedPathKey.includes("0")) return;
    revealTreeRow(itemRefs.current.get(secondaryId && entries.has(secondaryId) ? secondaryId : secondaryNavigationId));
  }, [project.id, secondaryId, secondaryNavigationId, secondaryPathKey, secondaryExpandedPathKey]);

  useEffect(() => {
    localPreferences.setJSON(persistenceKeys.treeExpansion, expansion);
  }, [expansion]);

  useEffect(() => {
    setFocusedId(activeEntryId);
    setQuery("");
    const ids = activePathKey ? activePathKey.split("\u0000") : [];
    setExpansion((previous) => {
      const existing = previous[project.id] || {};
      if (ids.every((id) => existing[id] === true)) return previous;
      return { ...previous, [project.id]: { ...existing, ...Object.fromEntries(ids.map((id) => [id, true])) } };
    });
  }, [project.id, activeId, activeEntryId, activePathKey]);

  useEffect(() => {
    if (!secondaryPathKey) return;
    const ids = secondaryPathKey.split("\u0000");
    setExpansion((previous) => {
      const existing = previous[project.id] || {};
      if (ids.every((id) => existing[id] === true)) return previous;
      return { ...previous, [project.id]: { ...existing, ...Object.fromEntries(ids.map((id) => [id, true])) } };
    });
  }, [project.id, secondaryId, secondaryPathKey]);

  function setExpanded(id: string, expanded: boolean) {
    setExpansion((previous) => ({ ...previous, [project.id]: { ...previous[project.id], [id]: expanded } }));
  }
  function canStartConversation(node?: PaperNode) {
    return !!node && (node.kind === "book" || node.id === projectNode?.id);
  }
  function canCompareEntry(entry: TreeEntry) {
    return !!onCompare && !!entry.node && entry.node.id !== activeId
      && !(activeIsPaper && entry.id === activeEntryId)
      && !(secondaryIsPaper && entry.node.id === secondaryNavigationId);
  }
  function focusEntry(id: string) {
    setFocusedId(id);
    const element = itemRefs.current.get(id);
    element?.focus({ preventScroll: true });
    revealTreeRow(element);
  }
  function activateEntry(entry: TreeEntry) {
    if (!entry.node) {
      if (!normalizedQuery) setExpanded(entry.id, !isExpanded(entry));
      return;
    }
    setSelectedEntryId(entry.id);
    setFocusedId(entry.id);
    setQuery("");
    // Reading a chapter only reveals its ancestors. Conversations and materials
    // have their own disclosure state and do not expand as a side effect.
    const path = ancestorEntries(entries, entry.id);
    setExpansion((previous) => ({ ...previous, [project.id]: { ...previous[project.id], ...Object.fromEntries(path.map((id) => [id, true])) } }));
    const match = searchMatches.get(entry.id);
    const matchedNode = match && project.paperTree?.nodes.find((node) => node.id === match.nodeId);
    if (normalizedQuery && matchedNode && onOpenSearch) onOpenSearch(matchedNode, match.messageId);
    else if (entry.material?.graphScopeId && onOpenScopeGraph) onOpenScopeGraph(entry.material.graphScopeId);
    else if (entry.material?.practiceEntry && onOpenPractice) onOpenPractice(entry.material.practiceEntry);
    else if (entry.material) (onOpenObject || onOpen)(entry.node);
    else onOpen(entry.node);
  }
  function handleKey(event: KeyboardEvent<HTMLLIElement>, entry: TreeEntry) {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    const index = visibleIds.indexOf(entry.id);
    const nested = visibleChildren(entry);
    const hasContents = nested.length > 0;
    let target: string | undefined;
    switch (event.key) {
      case "ArrowDown": target = visibleIds[Math.min(index + 1, visibleIds.length - 1)]; break;
      case "ArrowUp": target = visibleIds[Math.max(index - 1, 0)]; break;
      case "Home": target = visibleIds[0]; break;
      case "End": target = visibleIds[visibleIds.length - 1]; break;
      case "ArrowRight":
        if (hasContents && !isExpanded(entry)) setExpanded(entry.id, true);
        else target = nested[0];
        break;
      case "ArrowLeft":
        if (hasContents && isExpanded(entry) && !normalizedQuery) setExpanded(entry.id, false);
        else if (entry.parentId && visibleIds.includes(entry.parentId)) target = entry.parentId;
        break;
      case "Enter":
        if (event.shiftKey) {
          if (!entry.node || !canStartConversation(entry.node)) return;
          onNewBranch(entry.node.id);
        }
        else activateEntry(entry);
        break;
      case " ": activateEntry(entry); break;
      case "Insert":
        if (!entry.node || !canStartConversation(entry.node)) return;
        onNewBranch(entry.node.id);
        break;
      case "C":
      case "c":
        if (!event.shiftKey || !canCompareEntry(entry) || !entry.node) return;
        onCompare?.(entry.node);
        break;
      case "G":
      case "g":
        if (!event.shiftKey || !onOpenScopeGraph || !entry.node || !scopeIds.has(entry.id)) return;
        onOpenScopeGraph(entry.node.id);
        break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (target) focusEntry(target);
  }

  function renderEntry(id: string, depth: number, siblings: string[], position: number) {
    const entry = entries.get(id)!;
    const node = entry.node;
    const nested = visibleChildren(entry);
    const hasContents = nested.length > 0;
    const expanded = hasContents && isExpanded(entry);
    const isActive = !!node && (entry.material ? activeId === node.id : activeIsPaper && activeEntryId === id);
    const isSecondary = !!node && (entry.material ? secondaryId === node.id : secondaryIsPaper && node.id === secondaryNavigationId) && !isActive;
    const isTop = !entry.parentId;
    const isChapter = node?.role === "chapter";
    const isConversation = node?.kind === "chat" && entry.id !== projectNode?.id;
    const draggable = Boolean(node);
    const canCompare = canCompareEntry(entry);
    const Icon = entry.icon;
    const page = node?.anchor?.page;
    const pageDescription = page ? ` · 第 ${page}${node?.endPage && node.endPage > page ? `–${node.endPage}` : ""} 页` : "";
    const tooltip = entry.group ? `${expanded ? "收起" : "展开"}${entry.label}，${entry.children.length} 项`
      : `${entry.typeLabel} · ${entry.label}${pageDescription}${entry.material ? " · 点击浮窗预览，已打开则定位" : isConversation ? " · 继续此对话" : " · 点击阅读原文"}`;
    const lastQuestion = normalizedQuery ? searchMatches.get(entry.id)?.text || entry.summary?.lastQuestion : entry.summary?.lastQuestion;
    const questionPreview = conversationQuestionPreview(entry.label, lastQuestion);
    const recent = activityLabel(entry.summary?.lastInteractionAt);
    return (
      <li key={id} role="treeitem" tabIndex={tabStopId === id ? 0 : -1}
        aria-label={`${entry.label}，${entry.typeLabel}${entry.group ? `，${entry.children.length} 项` : isSecondary ? "，正在旁边对照" : isConversation ? "，继续此对话" : ""}`}
        aria-selected={node ? isActive : undefined} aria-expanded={hasContents ? expanded : undefined}
        aria-level={depth + 1} aria-posinset={position + 1} aria-setsize={siblings.length}
        ref={(element) => { if (element) itemRefs.current.set(id, element); else itemRefs.current.delete(id); }}
        onFocus={(event) => { if (event.target === event.currentTarget) setFocusedId(id); }}
        onKeyDown={(event) => handleKey(event, entry)}
        className={`${isTop ? "workspace-paper-root " : ""}${isConversation ? "workspace-paper-conversation " : ""}${entry.material ? "workspace-paper-material " : ""}${!node ? "workspace-paper-group" : ""}`}
      >
        <div className={`workspace-paper-row${isChapter ? " is-chapter" : ""}${isConversation ? " is-conversation" : ""}${isConversation && questionPreview ? " has-summary" : ""}${entry.material ? " is-material" : ""}${isActive ? " is-active" : ""}${isSecondary ? " is-secondary" : ""}${canCompare || canStartConversation(node) ? " has-actions" : ""}${normalizedQuery && !matchingIds.has(id) ? " is-ancestor" : ""}`}
          style={{ paddingLeft: `${9 + Math.min(depth, 8) * 12}px` }} title={`${tooltip}${draggable ? " · 可拖到工作区" : ""}` }
          draggable={draggable}
          onPointerDown={(event)=>beginPointerTransfer(event,entry)}
          onPointerMove={movePointerTransfer}
          onPointerUp={finishPointerTransfer}
          onPointerCancel={cancelPointerTransfer}
          onLostPointerCapture={cancelPointerTransfer}
          onDragStart={(event) => {
            if (pointerTransfer.current || !node || (event.target as HTMLElement).closest("button")) { event.preventDefault(); return; }
            writeWorkspaceTransfer(event.dataTransfer, project.id, node.id, entry.label, entry.material ? "object" : "paper");
          }}
          onClick={(event) => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); return; } focusEntry(id); activateEntry(entry); }}
        >
          {hasContents ? <button type="button" className={`workspace-paper-toggle${expanded ? " is-expanded" : ""}`}
            tabIndex={-1} aria-label={`${expanded ? "收起" : "展开"}${entry.label}`} disabled={!!normalizedQuery}
            onClick={(event) => { event.stopPropagation(); focusEntry(id); setExpanded(id, !expanded); }}
          ><ChevronRight size={13} aria-hidden="true" /></button> : <span className="workspace-paper-toggle-spacer" aria-hidden="true" />}
          {!isChapter && !entry.group && <span className="workspace-paper-icon" aria-hidden="true"><Icon size={14} /></span>}
          {isConversation ? <span className="workspace-paper-copy">
            <span className="workspace-paper-title">{entry.label}</span>
            {questionPreview && <span className="workspace-paper-meta">
              {recent && <time dateTime={entry.summary?.lastInteractionAt} title="最近提问">{recent}</time>}
              <span title={questionPreview}>{questionPreview}</span>
            </span>}
          </span> : <span className="workspace-paper-title">{entry.label}</span>}
          <span className="workspace-paper-trailing" aria-hidden="true">
            {entry.group ? <span className="workspace-paper-count">{entry.children.length}</span>
              : isSecondary ? <span className="workspace-paper-view-state">对照</span>
                : isChapter && page ? <span className="workspace-paper-page">{page}</span>
                  : entry.material?.questionCount ? <span className="workspace-paper-count">{entry.material.questionCount} 题</span>
                    : isConversation && !questionPreview && recent ? <time className="workspace-paper-time" dateTime={entry.summary?.lastInteractionAt} title="最近提问">{recent}</time> : null}
          </span>
          {node && (canCompare || canStartConversation(node)) && <span className="workspace-paper-actions">
            {canCompare && <button type="button" tabIndex={-1} title={`并排查看“${entry.label}”（Shift + C）`} aria-label={`并排查看${entry.label}`} aria-keyshortcuts="Shift+C"
              onClick={(event) => { event.stopPropagation(); onCompare?.(node); }}><PanelRightOpen size={14} aria-hidden="true" /></button>}
            {canStartConversation(node) && <button type="button" className="workspace-paper-ask" tabIndex={-1} title={`围绕“${entry.label}”在原文旁新建对话（Shift + Enter）`} aria-label={`围绕${entry.label}新建主对话`} aria-keyshortcuts="Shift+Enter Insert"
              onClick={(event) => { event.stopPropagation(); onNewBranch(node.id); }}><Plus size={14} aria-hidden="true" /></button>}
          </span>}
        </div>
        {expanded && <ul role="group">{nested.map((childId, index) => renderEntry(childId, depth + 1, nested, index))}</ul>}
      </li>
    );
  }

  return (
    <section className="workspace-paper-tree" aria-labelledby={headingId}>
      <div className="workspace-paper-heading"><h2 id={headingId}>阅读导航</h2></div>
      <label className="workspace-paper-search"><Search size={14} aria-hidden="true" />
        <input type="search" value={query} placeholder="搜索章节、对话或问题…" aria-label="搜索章节、对话或问题"
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" && visibleIds.length) { event.preventDefault(); focusEntry(firstResult?.id || tabStopId); }
            else if (event.key === "Enter" && firstResult) { event.preventDefault(); activateEntry(firstResult); }
            else if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); }
          }} />
        {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}><X size={13} aria-hidden="true" /></button>}
      </label>
      <div className="workspace-paper-scroll">
        {visibleEntries.length ? <ul role="tree" aria-labelledby={headingId} aria-describedby={helpId} className="workspace-paper-nodes">
          {visibleRoots.map((id, index) => renderEntry(id, 0, visibleRoots, index))}
        </ul> : <p className="workspace-paper-empty" role="status">{normalizedQuery ? `没有找到“${query.trim()}”` : "添加 PDF，开始阅读。"}</p>}
      </div>
      <p id={helpId} className="workspace-paper-sr-only">方向键浏览与展开，Enter 阅读章节或继续主对话，材料在浮窗预览。主对话与学习材料可分别展开；项目或章节上按 Shift 加 Enter 新建主对话，Shift 加 C 并排查看，Shift 加 G 打开知识图谱。可拖到工作区切换视图。</p>
      <div className="workspace-paper-footer">
        <button type="button" onClick={onImport}><Upload size={15} aria-hidden="true" /><span>添加资料</span></button>
        <button type="button" onClick={onManageSources}><FolderOpen size={15} aria-hidden="true" /><span>管理资料</span></button>
      </div>
    </section>
  );
}
