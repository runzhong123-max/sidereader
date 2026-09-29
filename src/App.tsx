import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  ArrowLeft,
  MessageSquare,
  FolderPlus,
  Plus,
  X,
  Settings2,
  PanelLeft,
  Pencil,
  Check,
  Loader2,
  Search,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import type {
  Project,
  ProjectStore,
  WorkspaceTab,
  Source,
  Stage,
  Evidence,
  Message,
  LearningObject,
  LearningAttempt,
  Paper,
  ReadingAnchor,
  ProjectProposal,
  PaperNode,
  Concept,
  QuestionSet,
  ReadingContext,
} from "./types";
import { initialWorkspace } from "./data";
import {
  loadProjects,
  loadWorkspace,
  saveProjects,
  removePdf,
} from "./persistence/project-repository";
import { api } from "./services/http";
import { localPreferences } from "./persistence/preferences.mjs";
import { persistenceKeys } from "./persistence/keys.mjs";
import { objectLabels, surfaceDefinition } from "./domain/objects.mjs";
import Tutor from "./components/Tutor";
import StudyWorkspace from "./components/StudyWorkspace";
import ConversationWorkspace, { ConversationPaperNavigation } from "./components/ConversationWorkspace";
import LearningSurface from "./components/LearningSurface";
import ActionMenu from "./components/ActionMenu";
import ThemeToggle from "./components/ThemeToggle";
import SourceEvidenceExcerpt from "./components/SourceEvidenceExcerpt";
import { findSourcePages } from "./source-search.mjs";
import ContentViewMenu from "./components/ContentViewMenu";
import { parseAnswer } from "./learning-objects.mjs";
import { openPaper, addAttempt, resolvePaperObject } from "./paper-state.mjs";
import type { QuestionDraft } from "./question-state.mjs";
import { questionObject } from "./question-state.mjs";
import {
  createProjectUpdate,
} from "./project-updates.mjs";
import { revertPaperProposal } from "./paper-proposal-undo.mjs";
import { capturePaperResults, restoreProposalBranches } from "./paper-results.mjs";
import { surfaceContent, replaceSurfaceSets } from "./domain/learning-surface.mjs";
import { documentForTarget, documentPage, pageBookmark, recordDocumentPosition, saveDocumentBookmark, toggleDocumentBookmark, removeDocument } from "./domain/documents.mjs";
import { discussionScope, discussionSources, nodeConversation } from "./discussion-scope.mjs";
import { readingDestination, knowledgeGraphOwner } from "./paper-navigation.mjs";
import { tutorSessions } from "./tutor-sessions.mjs";
import { conversationRoot, conversationResumeTarget, conversationOwner, newConversationParent } from "./conversation-model.mjs";
import { scopeConversation, ensureScopeConversation, ensureObjectConversation, objectConversationContext } from "./object-conversations.mjs";
import { defaultReadingTarget, enterReadingProject, restoreWorkspaceProject, readingCompanionKey } from "./reading-layout.mjs";
import { normalizePaperTree, attachPaperNode, nodeTitle, addProposalNodes, ensureScopeGraph, scopeGraphId } from "./paper-tree-state.mjs";
import { loadInitialProjects } from "./project-loading.mjs";
import {
  prerequisiteWouldCycle,
  removeStage,
  restoreRemovedStage,
} from "./stage-state.mjs";
import PaperTree from "./components/PaperTree";
import FloatingObject from "./components/FloatingObject";
import { writeWorkspaceTransfer } from "./object-transfer.mjs";
import { WORKSPACE_POINTER_EVENT, type WorkspacePointerUpdate } from "./workspace-pointer-transfer.mjs";
import { navigateFloatingContent, placeWorkspaceContent, revealWorkspaceContent, workspaceContentLocation, validWorkspaceViews, workspaceContent, type WorkspacePlacement, type WorkspaceView } from "./workspace-placement.mjs";
import { referenceScope } from "./reference-scope.mjs";
import { copyReaderSession, captureReaderSession, restoreReaderSession } from "./reader-sessions.mjs";
import { createReadingHistory, type ReadingVisit } from "./reading-history.mjs";
import type { AutomaticGraphState } from "./components/Graph";
import { useAutomaticGraph } from "./use-automatic-graph";
import PracticeOverview from "./components/PracticeOverview";
import type { PracticeEntry } from "./practice-catalog.mjs";
import { practiceCatalog } from "./practice-catalog.mjs";
import { persistMessagePractice } from "./practice-state.mjs";
import { conversationGraphNodeId } from "./conversation-graphs.mjs";
import {
  ImportModal,
  Modal,
  SettingsModal,
  type ModelConfig,
} from "./components/Modals";
const Reader = lazy(() => import("./components/Reader"));
function newProject(name: string, goal: string): Project {
  const chatId = crypto.randomUUID();
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    goal,
    sources: [],
    concepts: [],
    stages: [],
    sets: [],
    activeSource: "",
    page: 1,
    chats: [{ id: chatId, title: "新的对话", messages: [] }],
    tabs: [{ id: chatId, kind: "chat" }],
    activeTab: chatId,
  };
}
function seedProject(): Project {
  const p = newProject(initialWorkspace.name, initialWorkspace.goal);
  return { ...p, ...initialWorkspace };
}
function tabTitle(tab: WorkspaceTab, project: Project) {
  if (tab.kind === "chat")
    return project.chats.find((c) => c.id === tab.id)?.title || "新的对话";
  if (tab.kind === "book")
    return project.sources.find((s) => s.id === tab.sourceId)?.title || "阅读";
  if (tab.kind === "paper") {
    const paper = project.papers?.find((p) => p.id === tab.id);
    return paper ? resolvePaperObject(project, paper).title : surfaceDefinition("paper").title;
  }
  if (tab.kind === "graph" || tab.kind === "path") return surfaceDefinition(tab.kind).projectTitle;
  return project.sets.find((s) => s.id === tab.objectId)?.title || "练习";
}
export default function App() {
  const [store, setStore] = useState<ProjectStore>(() => {
    const p = seedProject();
    return { version: 2, projects: [normalizePaperTree(p)], activeProjectId: p.id };
  });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const [saveRevision, setSaveRevision] = useState(0);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">(
    "saving",
  );
  const [sourceManagerOpen, setSourceManagerOpen] = useState(false);
  const [messageFocus, setMessageFocus] = useState<{nodeId:string;messageId:string;key:number}>();
  const [composerFocus, setComposerFocus] = useState<{nodeId:string;key:string}>();
  const clearComposerFocus = useCallback(() => setComposerFocus(undefined), []);
  const [sidebar, setSidebar] = useState(false);
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const sidebarTrigger = useRef<HTMLButtonElement | null>(null);
  const sidebarClose = useRef<HTMLButtonElement>(null);
  const sidebarElement = useRef<HTMLElement>(null);
  const closeSidebar = useCallback(() => {
    setSidebar(false);
    setSidebarDragging(false);
    requestAnimationFrame(() => {
      const trigger = sidebarTrigger.current;
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
    });
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localPreferences.getJSON<boolean>(persistenceKeys.treeCollapsed, false) === true);
  const [workspaceViews, setWorkspaceViews] = useState<Record<string, WorkspaceView>>(() => validWorkspaceViews(localPreferences.getJSON(persistenceKeys.workspaceViews, {})));
  const [companionExpanded, setCompanionExpanded] = useState(false);
  const [pendingConcept, setPendingConcept] = useState<{nodeId:string;id:string;key:string}>();
  const [pendingQuestion, setPendingQuestion] = useState<{nodeId:string;id:string;key:string}>();
  const [floatingObjects, setFloatingObjects] = useState<Array<{projectId:string;nodeId:string}>>([]);
  const [floatingOrder, setFloatingOrder] = useState<string[]>([]);
  const [companionOnly, setCompanionOnly] = useState(false);
  const [focusedContent, setFocusedContent] = useState<{projectId:string;nodeId:string}>();
  const [conversationVisits, setConversationVisits] = useState<Record<string,string>>(()=>{
    const value = localPreferences.getJSON<unknown>(persistenceKeys.conversationVisits,{});
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string,string]=>typeof entry[1]==="string")) : {};
  });
  const [readingReturn, setReadingReturn] = useState<{projectId:string;nodeId:string}>();
  const [readingHistory] = useState(() => createReadingHistory());
  const [, refreshReadingHistory] = useState(0);
  const [companions, setCompanions] = useState<Record<string, string>>(() => {
    const value = localPreferences.getJSON<unknown>(persistenceKeys.companions, {});
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string,string] => typeof entry[1] === "string")) : {};
  });
  const [navigationKeys, setNavigationKeys] = useState<Record<string, number>>({});
  const [referencePages, setReferencePages] = useState<Record<string, number>>(()=>{
    const value = localPreferences.getJSON<unknown>(persistenceKeys.referencePages,{});
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string,number]=>typeof entry[1]==="number" && Number.isFinite(entry[1]) && entry[1]>=1)) : {};
  });
  const [referenceAnchors, setReferenceAnchors] = useState<Record<string,ReadingAnchor>>({});
  const [referenceContent, setReferenceContent] = useState<Record<string,{page:number;text?:string;image?:string}>>({});
  useEffect(() => {
    localPreferences.setJSON(persistenceKeys.workspaceViews, workspaceViews);
    localPreferences.setJSON(persistenceKeys.companions, companions);
    localPreferences.setJSON(persistenceKeys.referencePages, referencePages);
  }, [workspaceViews, companions, referencePages]);
  const [configured, setConfigured] = useState(false);
  const [settings, setSettings] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [projectEdit, setProjectEdit] = useState<"new" | "edit" | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [stageEdit, setStageEdit] = useState<Stage | null>(null);
  const [stageEditTargetId, setStageEditTargetId] = useState<string>();
  const [deleteSource, setDeleteSource] = useState<Source | null>(null);
  const [deleteProject, setDeleteProject] = useState(false);
  const [selected, setSelected] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [visibleText, setVisibleText] = useState("");
  const [pageImage, setPageImage] = useState("");
  const [toast, setToast] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    setLoadError("");
    setReady(false);
    (async () => {
      try {
        const saved = await loadInitialProjects({
          loadProjects,
          loadWorkspace,
          bootstrap: () => api<ProjectStore | null>("/api/bootstrap"),
          seed: seedProject,
        });
        if (active) {
          setStore({ ...saved, projects: saved.projects.map((item)=>restoreWorkspaceProject(restoreProposalBranches(normalizePaperTree(item)), workspaceViews[item.id]?.mainId)) });
          setReady(true);
        }
      } catch (error) {
        if (active)
          setLoadError(
            error instanceof Error
              ? error.message
              : "请检查 Safari 的存储权限后重试。",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [loadRevision]);
  useEffect(() => {
    api<ModelConfig>("/api/status")
      .then((c) => setConfigured(c.configured))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!ready || loadError) return;
    let active = true;
    setSaveState("saving");
    saveQueue.current = saveQueue.current
      .then(() => saveProjects(store))
      .then(() => {
        if (active) setSaveState("saved");
      })
      .catch(() => {
        if (active) setSaveState("error");
      });
    return () => {
      active = false;
    };
  }, [store, ready, loadError, saveRevision]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const project =
    store.projects.find((p) => p.id === store.activeProjectId) ||
    store.projects[0];
  useEffect(() => {
    if (!sidebar) { setSidebarDragging(false); return; }
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    const frame = requestAnimationFrame(() => sidebarClose.current?.focus({ preventScroll: true }));
    const keydown = (event: KeyboardEvent) => {
      // Dialogs launched from the drawer keep their own keyboard handling.
      if (event.defaultPrevented || !sidebarElement.current?.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault(); closeSidebar();
      } else if (event.key === "Tab") {
        const items = [...(sidebarElement.current?.querySelectorAll<HTMLElement>("button, a[href], input, select, [tabindex='0']") || [])]
          .filter((item) => !item.matches(":disabled") && item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const transfer = (event: Event) => {
      const update = (event as CustomEvent<WorkspacePointerUpdate>).detail;
      if (update?.projectId === project.id) setSidebarDragging(update.phase === "move");
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener(WORKSPACE_POINTER_EVENT, transfer);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener(WORKSPACE_POINTER_EVENT, transfer);
    };
  }, [sidebar, project.id, closeSidebar]);
  const tab =
    project.tabs.find((t) => t.id === project.activeTab) || project.tabs[0];
  const workspaceView = workspaceViews[project.id];
  const comparisonRequested = workspaceView?.comparisonOpen ?? true;
  const companionSide = workspaceView?.side || "right";
  function setWorkspaceView(change: Partial<WorkspaceView>) {
    setWorkspaceViews((previous)=>({...previous,[project.id]:{...(previous[project.id] || {comparisonOpen:true,side:"right"}),...change}}));
  }
  function setComparisonOpen(open: boolean) { setWorkspaceView({comparisonOpen:open}); }
  function setCompanionSide(side: "left" | "right") { setWorkspaceView({side}); }
  const source = documentForTarget(project,tab);
  const page = documentPage(source);
  const companionKey = readingCompanionKey(project.id,tab.id);
  const treeNodes = project.paperTree?.nodes || [];
  const practiceEntries = useMemo(()=>practiceCatalog(project),[project]);
  const referenceConcepts = useMemo(()=>[...project.concepts,...(project.paperTree?.nodes || []).flatMap((node)=>node.graphConcepts || [])],[project.concepts,project.paperTree]);
  const currentNode = treeNodes.find((node) => node.id === tab.id);
  useEffect(()=>{
    if (focusedContent?.projectId !== project.id) return;
    if (!treeNodes.some((node)=>node.id===focusedContent.nodeId && node.kind==="chat")) return;
    const root = conversationRoot(project,focusedContent.nodeId);
    if (!root) return;
    const key = `${project.id}:${root.id}`;
    setConversationVisits((previous)=>previous[key]===focusedContent.nodeId ? previous : {...previous,[key]:focusedContent.nodeId});
  },[project,focusedContent]);
  useEffect(()=>{localPreferences.setJSON(persistenceKeys.conversationVisits,conversationVisits);},[conversationVisits]);
  const requestedCompanionId = companions[companionKey];
  let requestedScopeId = tab.id;
  if (requestedCompanionId?.startsWith("scope-chat:")) {
    try { requestedScopeId=decodeURIComponent(requestedCompanionId.slice("scope-chat:".length)); } catch { /* Ignore malformed old layout preferences. */ }
  }
  const defaultCompanion = scopeConversation(project,requestedScopeId,requestedCompanionId);
  const savedCompanion = treeNodes.find((node)=>node.id===companions[companionKey]);
  const companionNode = savedCompanion || defaultCompanion.node;
  const companionId = companionNode.id;
  const comparisonOpen = comparisonRequested && companionId !== tab.id;
  const visibleNode = comparisonOpen && companionOnly ? companionNode : currentNode;
  const visibleId = visibleNode?.id || tab.id;
  const activeTitle = visibleNode ? (surfaceDefinition(visibleNode.kind) ? objectWindowTitle(visibleNode) : nodeTitle(project,visibleNode)) : tabTitle(tab,project);
  const returnNode = readingReturn?.projectId === project.id ? treeNodes.find((node)=>node.id===readingReturn.nodeId) : undefined;
  const visibleDocument = documentForTarget(project,visibleNode || tab);
  const visiblePage = comparisonOpen && companionOnly
    ? referencePages[`${project.id}:reference:${visibleId}`] || documentPage(visibleDocument)
    : documentPage(visibleDocument);
  const objectScopeId = visibleDocument
    ? conversationOwner(project,visibleId,{sourceId:visibleDocument.id,title:visibleDocument.title,page:visiblePage})?.id || visibleId
    : visibleId;
  function selectCompanion(id: string) {
    const target = treeNodes.find((node)=>node.id===id) || (companionNode.id===id ? companionNode : {id,kind:"chat" as const});
    presentContent(target,companionSide,true);
  }
  function currentPlacement(): WorkspacePlacement {
    return {mainId:tab.id,companionId,comparisonOpen,side:companionSide,
      floatingIds:floatingObjects.filter((item)=>item.projectId===project.id).map((item)=>item.nodeId)};
  }
  function focusContent(id: string) {
    setFocusedContent({projectId:project.id,nodeId:id});
    requestAnimationFrame(()=>{
      const surface = Array.from(document.querySelectorAll<HTMLElement>("[data-workspace-node-id]"))
        .find((element)=>element.dataset.workspaceNodeId===id && !element.closest("[hidden]"));
      const field = surface?.querySelector<HTMLElement>("textarea, [data-reader-focus]");
      (field || surface)?.focus({preventScroll:true});
    });
  }
  function openPrimary(target: WorkspaceTab) { presentContent(target,"main"); }
  function rememberMainAsReference(target: WorkspaceTab) {
    if (!source || target.id !== tab.id) return;
    const key = `${project.id}:reference:${target.id}`;
    const copied = copyReaderSession(`${project.id}:${target.id}`,key,{sourceId:source.id,navigationKey:navigationKeys[key] || 0});
    setReferencePages((previous)=>({...previous,[key]:copied?.anchor?.page || page}));
    setReferenceAnchors((previous)=>{const next={...previous};delete next[key];return next;});
  }
  function compareObject(target: WorkspaceTab, side: "left" | "right" = "right") { presentContent(target,side); }
  function floatObject(target: WorkspaceTab) { presentContent(target,"float",true); }
  function navigateFromFloating(fromId: string, target: WorkspaceTab) {
    const next = navigateFloatingContent(currentPlacement(),fromId,target.id,companionOnly);
    setFloatingObjects((previous)=>[...previous.filter((item)=>item.projectId!==project.id),...next.floatingIds.map((nodeId)=>({projectId:project.id,nodeId}))]);
    setComparisonOpen(next.comparisonOpen);
    if (target.id===tab.id) setCompanionExpanded(false);
    else if (target.id!==companionId || !comparisonOpen) raiseFloatingObject(`${project.id}:${target.id}`);
    focusContent(target.id);
  }
  function raiseFloatingObject(id: string) {
    // Keep DOM order stable while a header owns pointer capture.
    setFloatingOrder((previous)=>previous.at(-1)===id ? previous : [...previous.filter((item)=>item!==id),id]);
  }
  function objectWindowTitle(node: PaperNode) {
    if (node.graphConcepts) return nodeTitle(project,node);
    if (node.kind === "chat" && node.id.startsWith("scope-chat:") && !project.chats.some((chat)=>chat.id===(node.objectId || node.id)))
      return scopeConversation(project,node.parentId || tab.id,node.id).chat.title;
    const definition = surfaceDefinition(node.kind);
    if (definition && node.id === node.kind) return definition.projectTitle;
    const owner = node.kind === "graph" ? conversationOwner(project,node.id) : undefined;
    return owner?.role === "chapter" ? `知识图谱 · ${nodeTitle(project,owner)}` : nodeTitle(project,node);
  }
  function referenceTarget(scopeId: string) {
    const preferred = comparisonOpen && companionNode.kind === "chat" ? companionId : tab.kind === "chat" ? tab.id : undefined;
    const target = scopeConversation(project,scopeId,preferred).node;
    presentContent(target,"right",true);
    return target;
  }
  function contentTypeLabel(target: WorkspaceTab) {
    if (target.kind === "book") return "PDF";
    if (target.kind === "chat") return "对话";
    if (target.kind === "graph") return "图谱";
    if (target.kind === "questions") return "习题";
    const object = target.kind === "paper" ? surfaceContent(project,target).object : undefined;
    return object ? objectLabels[object.kind] : surfaceDefinition(target.kind)?.title || "";
  }
  function referenceConcept(id: string, scopeId = objectScopeId) {
    const target = referenceTarget(scopeId);
    setPendingConcept({nodeId:target.id,id,key:crypto.randomUUID()});
  }
  function referenceQuestion(object: LearningObject, scopeId = objectScopeId) {
    const target = referenceTarget(scopeId);
    setPendingQuestion({nodeId:target.id,id:object.id,key:crypto.randomUUID()});
  }
  function askObject(target: WorkspaceTab, question?: LearningObject) {
    const result = ensureObjectConversation(project,target.id);
    if (!result.nodeId) return;
    updateProject(project.id,(current)=>ensureObjectConversation(current,target.id).project);
    presentContent({id:result.nodeId,kind:"chat"},"right",true);
    if (question) setPendingQuestion({nodeId:result.nodeId,id:question.id,key:crypto.randomUUID()});
    setComposerFocus({nodeId:result.nodeId,key:crypto.randomUUID()});
  }
  function openNavigation(target: WorkspaceTab, resumeConversation = true) {
    if (target.kind === "book") {
      openPrimary(target);
      return;
    }
    if (target.kind !== "chat") { floatObject(target); return; }
    const root = conversationRoot(project,target.id);
    if (resumeConversation && root?.id === target.id) target = conversationResumeTarget(project,root.id,conversationVisits[`${project.id}:${root.id}`]) || target;
    if (workspaceContentLocation(currentPlacement(),target.id)) {
      presentContent(target,"right",true);
      return;
    }
    // Navigation selects content. A reader's chosen open/closed layout is not a
    // side effect of changing chapter; supporting content opens beside the PDF.
    const reader = tab.kind === "book" ? tab : defaultReadingTarget(project,target.id);
    if (reader) {
      openPrimary(reader);
      setCompanions((previous)=>({...previous,[readingCompanionKey(project.id,reader.id)]:target.id}));
      setWorkspaceView({mainId:reader.id,side:"right",comparisonOpen:true});
      setFloatingObjects((previous)=>previous.filter((item)=>item.projectId!==project.id || (item.nodeId!==target.id && item.nodeId!==reader.id)));
      setCompanionExpanded(false);
      focusContent(target.id);
    } else openPrimary(target);
  }
  function askReading(target: WorkspaceTab, reading?: ReadingContext) {
    if (!reading) return;
    const preferred = tab.kind === "chat" ? tab.id : companions[readingCompanionKey(project.id,target.id)];
    const conversation = scopeConversation(project,target.id,preferred).node;
    if (comparisonOpen && target.id === companionId && !workspaceContentLocation(currentPlacement(),conversation.id)) {
      // Explicit follow-up in the side PDF keeps that PDF where it is.
      updateProject(project.id,(current)=>ensureScopeConversation(current,target.id,conversation.id).project);
      presentContent(conversation,"main",true);
    } else presentContent(conversation,"right",true);
    const referenceSnapshot = referenceContent[`${project.id}:reference:${target.id}`];
    const selectedImage = target.id===tab.id ? reading.page===page ? pageImage : ""
      : referenceSnapshot?.page===reading.page ? referenceSnapshot.image || "" : "";
    tutorSessions.lockReading(`${project.id}:${conversation.id}`,reading.quote ? reading : null,selectedImage);
    setComposerFocus({nodeId:conversation.id,key:crypto.randomUUID()});
  }
  function presentContent(target: WorkspaceTab, position: "main" | "left" | "right" | "float", reveal = false) {
    if (!workspaceContent(target.kind)) return;
    if (target.kind === "graph" && !treeNodes.some((node)=>node.id===target.id)) {
      const chapter = treeNodes.find((node)=>node.role === "chapter" && scopeGraphId(node.id)===target.id);
      if (chapter) updateProject(project.id,(current)=>ensureScopeGraph(current,chapter.id));
    }
    const fallback = defaultReadingTarget(project,target.id);
    const next = reveal ? revealWorkspaceContent(currentPlacement(),target.id,position,companionOnly,fallback?.id)
      : placeWorkspaceContent(currentPlacement(),target.id,position,fallback?.id);
    if (!reveal && position === "float" && !next.floatingIds.includes(target.id)) return;
    const nextMain = next.mainId === target.id ? target : treeNodes.find((node)=>node.id===next.mainId) || (companionNode.id===next.mainId ? companionNode : undefined);
    if (!nextMain) return;
    if (position === "float" && target.id === tab.id) rememberMainAsReference(target);
    const fromFloating = floatingObjects.some((item)=>item.projectId===project.id && item.nodeId===nextMain.id);
    if (next.mainId !== tab.id || (position === "main" && fromFloating && nextMain.kind === "book")) {
      if (next.companionId === tab.id) rememberMainAsReference(tab);
      const document = documentForTarget(project,nextMain);
      const referenceKey = `${project.id}:reference:${nextMain.id}`;
      const mainKey = `${project.id}:${nextMain.id}`;
      const fromReference = document && (nextMain.id === companionId || fromFloating);
      const copied = fromReference ? copyReaderSession(referenceKey,mainKey,{sourceId:document.id,navigationKey:(navigationKeys[mainKey] || 0)+1}) : undefined;
      const referencePage = fromReference ? copied?.anchor?.page || referencePages[referenceKey] : undefined;
      openTab(nextMain,document && referencePage ? {sourceId:document.id,title:document.title,page:referencePage} : undefined);
    }
    if (next.companionId) setCompanions((previous)=>({...previous,[readingCompanionKey(project.id,next.mainId)]:next.companionId!}));
    setWorkspaceView({mainId:next.mainId,comparisonOpen:!reveal && position === "main" && companionOnly ? false : next.comparisonOpen,side:next.side});
    setFloatingObjects((previous)=>[...previous.filter((item)=>item.projectId!==project.id),...next.floatingIds.map((nodeId)=>({projectId:project.id,nodeId}))]);
    if (next.floatingIds.includes(target.id)) raiseFloatingObject(`${project.id}:${target.id}`);
    if (!reveal || target.id===tab.id || next.mainId!==tab.id || next.comparisonOpen!==comparisonOpen) setCompanionExpanded(false);
    setSourceManagerOpen(false); setSidebar(false);
    focusContent(target.id);
  }
  function dropObject(id: string, position: "main" | "left" | "right" | "float") {
    const node = treeNodes.find((item)=>item.id===id);
    if (node) { presentContent(node,position); return; }
    const chapter = treeNodes.find((item)=>item.role === "chapter" && scopeGraphId(item.id)===id);
    if (chapter) { presentContent({id,kind:"graph"},position); return; }
    // Inline checks already have a canonical question, but need no paper until used separately.
    for (const set of project.sets) {
      const question = set.questions.find((item)=>questionObject(set.id,item).id===id);
      if (!question) continue;
      const owner = treeNodes.find((item)=>item.kind === "questions" && item.objectId === set.id) || tab;
      openObject(questionObject(set.id,question),set.sourceMessageId || "",[],owner,position);
      return;
    }
    // Inline objects use their stable message identity until first detached.
    for (const chat of project.chats) {
      for (const message of chat.messages) {
        if (message.role !== "assistant") continue;
        const savedQuestion = message.questionSets?.flatMap((set)=>set.questions.map((question)=>questionObject(set.id,question))).find((object)=>object.id===id);
        const object = savedQuestion || parseAnswer(message.content,message.id).find((part)=>part.object?.id===id)?.object;
        if (!object) continue;
        const origin = treeNodes.find((item)=>item.kind==="chat" && (item.objectId || item.id)===chat.id);
        if (origin) openObject(object,message.id,message.evidence || [],origin,position);
        return;
      }
    }
  }
  const updateProject = useCallback(
    (id: string, change: Partial<Project> | ((p: Project) => Project)) =>
      setStore((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === id
            ? normalizePaperTree(typeof change === "function" ? change(p) : { ...p, ...change })
            : p,
        ),
      })),
    [],
  );
  const patch = (change: Partial<Project>) => updateProject(project.id, change);
  const automaticGraph = useAutomaticGraph(project, [objectScopeId,tab.id, ...(comparisonOpen ? [companionId] : []), ...floatingObjects.filter((item)=>item.projectId===project.id).map((item)=>item.nodeId)], ready && configured && !loadError, updateProject);
  function graphStatus(node: PaperNode | undefined, concepts: Concept[]): AutomaticGraphState | undefined {
    if (node?.graphConcepts) return undefined;
    const state = node?.autoGraph;
    const activePlan = automaticGraph.plans.some((plan)=>plan.graphId === node?.id);
    return node?.kind === "graph" && (node.id === "graph" || node.role === "scope-graph") ? {
      status: state?.status === "ready" && concepts.length ? "idle" : !configured ? "waiting-model" : !activePlan ? "waiting-source" :
        state?.status === "error" ? "error" :
        state?.status === "generating" ? "generating" :
        state?.status === "ready" && !concepts.length ? "empty" : "idle",
      message: state?.error,
      coverage: state?.coverage,
      scopeLabel: node.role === "scope-graph" ? "本章" : "项目",
      busy: automaticGraph.busy,
      onRetry: activePlan ? ()=>automaticGraph.retry(node.id) : undefined,
      onSettings: () => setSettings(true),
    } : undefined;
  }
  function openTab(next: WorkspaceTab, requestedAnchor?: ReadingAnchor) {
    setFocusedContent({projectId:project.id,nodeId:next.id});
    setFloatingObjects((previous)=>previous.filter((item)=>item.projectId!==project.id || item.nodeId!==next.id));
    setReadingReturn(undefined);
    setSidebar(false);
    setCompanionExpanded(false);
    if (
      next.kind === "book" &&
      !project.sources.some((s) => s.id === next.sourceId)
    ) {
      setToast("原资料已移除，学习对象与对话仍保留。");
      return;
    }
    setWorkspaceView({mainId:next.id});
    const targetNode = treeNodes.find((node) => node.id === next.id);
    const savedAnchor = targetNode?.anchor && targetNode.role === "chapter" && targetNode.progress ? {...targetNode.anchor,page:targetNode.progress} : targetNode?.anchor;
    const anchor = requestedAnchor || (next.kind === "book" && targetNode?.role !== "source" ? savedAnchor : undefined);
    if (next.kind === "book" && (requestedAnchor || targetNode?.role === "bookmark")) {
      const navigationId = `${project.id}:${next.id}`;
      setNavigationKeys((keys) => ({...keys,[navigationId]:(keys[navigationId] || 0)+1}));
    }
    updateProject(project.id, (p) => {
      const existing = p.paperTree?.nodes.find((node) => node.id === next.id);
      const parentId = next.id.startsWith("discussion:") ? next.objectId || tab.id : tab.id;
      const registered = existing ? p : attachPaperNode(p, {...next,parentId,origin:"manual"});
      return {
        ...registered,
        tabs: registered.tabs.some((t) => t.id === next.id) ? registered.tabs : [...registered.tabs, next],
        activeTab: next.id,
        activeSource: next.kind === "book" ? next.sourceId || registered.activeSource : registered.activeSource,
        sources: next.kind === "book" && anchor ? registered.sources.map((item) => item.id === anchor.sourceId ? {...item,progress:anchor.page} : item) : registered.sources,
      };
    });
    setSelected("");
    setEvidenceText(targetNode?.role === "bookmark" ? anchor?.quote || "" : "");
    setVisibleText("");
    setPageImage("");
    if (window.innerWidth < 1100) setSourceManagerOpen(false);
  }
  function recordAttempt(attempt: LearningAttempt) {
    updateProject(project.id, (p) => addAttempt(p, attempt));
  }
  function recordQuestionDraft(objectId: string, draft: QuestionDraft) {
    updateProject(project.id, (p) => ({
      ...p,
      questionDrafts: { ...p.questionDrafts, [objectId]: draft },
    }));
  }
  function openObject(
    object: LearningObject,
    sourceMessageId = "",
    evidence: Evidence[] = [],
    parentTab: WorkspaceTab = tab,
    position: "main" | "left" | "right" | "float" | "navigation" = "navigation",
  ) {
    const id = project.papers?.find((paper)=>paper.object.id===object.id)?.id || `paper:${encodeURIComponent(object.id)}`;
    updateProject(project.id, (p) => {
      const paper: Paper = {
        id,
        parentId: parentTab.id,
        parentTitle: nodeTitle(project, {...parentTab,parentId:null}),
        parentTab,
        title: object.title,
        sourceMessageId,
        object,
        evidence,
        created: new Date().toISOString(),
      };
      const next = openPaper(p, paper);
      const registered = next.paperTree?.nodes.some((node)=>node.id===next.activeTab) ? next : attachPaperNode(next, {id:next.activeTab,kind:"paper",objectId:next.activeTab,parentId:parentTab.id,sourceMessageId,origin:"object"});
      return {...registered,activeTab:p.activeTab};
    });
    const target: WorkspaceTab = {id,kind:"paper",objectId:id};
    if (position === "navigation") openNavigation(target);
    else presentContent(target,position);
  }
  function createBranch(parentId = tab.id, quote = "", sourceMessageId = "", evidence: Evidence[] = [], reading?: ReadingContext, independent = false, navigate?: (target: WorkspaceTab)=>void) {
    const parent = treeNodes.find((node) => node.id === parentId) || currentNode;
    const parentPaper = project.papers?.find((paper) => paper.id === (parent?.kind === "chat" ? parent.objectId || parentId : parentId));
    const parentChat = independent ? undefined : nodeConversation(project,parent);
    const parentAnswer = sourceMessageId
      ? parentChat?.messages.find((message)=>message.id===sourceMessageId && message.role==="assistant" && !message.error)
      : undefined;
    const parentSource = parent?.kind === "book" ? project.sources.find((item)=>item.id===parent.sourceId) : undefined;
    const inheritedReading = reading || parentChat?.context?.reading || parentAnswer?.readingContext || (parent?.role === "bookmark" ? parent.anchor : undefined);
    const branchParent = independent ? conversationOwner(project,parentId,inheritedReading) : newConversationParent(project,parentId,inheritedReading);
    if (!branchParent) return;
    const isIndependent = independent || !conversationRoot(project,parentId);
    const scope = discussionScope(project,parentId);
    const originMessageId = sourceMessageId || parentPaper?.sourceMessageId || "";
    const object: LearningObject | undefined = parentPaper ? resolvePaperObject(project, parentPaper)
      : parent?.kind === "graph" ? {id:`context:${parentId}`,kind:"concept",title:nodeTitle(project,parent),content:project.concepts.filter((item)=>!parent.conceptIds || parent.conceptIds.includes(item.id)).map((item)=>`${item.name}：${item.description}`).join("\n\n")}
      : parent?.kind === "path" ? {id:`context:${parentId}`,kind:"note",title:nodeTitle(project,parent),content:project.stages.filter((item)=>!parent.stageIds || parent.stageIds.includes(item.id)).map((item)=>`${item.title}：${item.description}`).join("\n\n")}
      : parent?.role === "chapter" && parentSource ? {id:`context:${parentId}`,kind:"source",title:nodeTitle(project,parent),content:`资料：${parentSource.title}\n范围：第 ${parent.anchor?.page || 1}–${parent.endPage || parentSource.pages.length} 页。围绕这个章节讨论。`}
      : undefined;
    const contextQuote = quote || object?.content || parentAnswer?.content || "";
    const contextEvidence = evidence.length ? evidence : parentPaper?.evidence || parentAnswer?.evidence || [];
    const id = crypto.randomUUID();
    const title = quote ? quote.replace(/[*_`#]/g, "").replace(/\[\d+\]/g, "").replace(/\s+/g," ").slice(0,34)
      : reading ? `第 ${reading.page} 页的追问` : "新的话题";
    updateProject(project.id, (p) => {
      return attachPaperNode({
        ...p,
        chats:[...p.chats,{id,title,messages:[],context:{parentId,...scope,sourceMessageId:originMessageId,quote:contextQuote,reading:inheritedReading,object,evidence:contextEvidence}}],
        tabs:[...p.tabs,{id,kind:"chat"}],
      },{id,kind:"chat",parentId:branchParent.id,conversationRoot:isIndependent,origin:quote ? "selection" : "manual",sourceMessageId:originMessageId,quote:contextQuote,anchor:inheritedReading,created:new Date().toISOString()});
    });
    setSelected("");
    const child: WorkspaceTab = {id,kind:"chat"};
    if (navigate) navigate(child);
    else if (!isIndependent && parent?.kind === "chat") {
      if (comparisonOpen && parentId === companionId) selectCompanion(id);
      else openPrimary(child);
    } else {
      const readingTarget = defaultReadingTarget(project,branchParent.id);
      if (readingTarget) {
        if (readingTarget.id !== tab.id) openTab(readingTarget);
        setCompanions((previous)=>({...previous,[readingCompanionKey(project.id,readingTarget.id)]:id}));
        setWorkspaceView({mainId:readingTarget.id,comparisonOpen:true,side:"right"});
      } else openPrimary(child);
    }
    setComposerFocus({nodeId:id,key:crypto.randomUUID()});
    setCompanionExpanded(false); setSidebar(false);
    return id;
  }
  function newChat() {
    if (visibleNode && ["graph","questions","paper"].includes(visibleNode.kind)) askObject(visibleNode);
    else createBranch(visibleId);
  }
  function returnToParent(node: PaperNode, navigate?: (target: WorkspaceTab)=>void) {
    const context = nodeConversation(project,node)?.context;
    const originId = context?.parentId || node.parentId;
    const parent = treeNodes.find((item) => item.id === originId);
    if (!parent) return;
    const anchor = context?.reading || node.anchor;
    const sourceMessageId = context?.sourceMessageId || node.sourceMessageId;
    if (parent.kind === "book" && anchor) { readAnchor(anchor,node); return; }
    if (navigate) {
      navigate(parent);
      if (sourceMessageId) setMessageFocus({nodeId:parent.id,messageId:sourceMessageId,key:Date.now()});
      return;
    }
    if (comparisonOpen && parent.id === tab.id) {
      setComparisonOpen(false); setCompanionExpanded(false); return;
    }
    if (comparisonOpen && node.id === companionId && parent.kind !== "book") {
      selectCompanion(parent.id);
      if (sourceMessageId) setMessageFocus({nodeId:parent.id,messageId:sourceMessageId,key:Date.now()});
      return;
    }
    openTab(parent);
    if (sourceMessageId) setMessageFocus({nodeId:parent.id,messageId:sourceMessageId,key:Date.now()});
  }
  function openScopeGraph(parentId: string) {
    const owner = knowledgeGraphOwner(project,parentId);
    const id = owner?.role === "chapter" ? scopeGraphId(owner.id) : "graph";
    if (owner?.role === "chapter") updateProject(project.id,(p)=>ensureScopeGraph(p,owner.id));
    openNavigation({id,kind:"graph"});
  }
  function saveConceptSubset(node: PaperNode | undefined, concepts: Concept[]) {
    updateProject(project.id, (p) => {
      if (node?.graphConcepts) return {...p,paperTree:p.paperTree && {...p.paperTree,nodes:p.paperTree.nodes.map((item)=>item.id===node.id ? {...item,graphConcepts:concepts} : item)}};
      if (!node?.conceptIds) return {...p,concepts};
      const incoming = new Set(concepts.map((item)=>item.id));
      return {...p,concepts:[...p.concepts.filter((item)=>!incoming.has(item.id)),...concepts],paperTree:p.paperTree && {...p.paperTree,nodes:p.paperTree.nodes.map((item)=>item.id===node.id?{...item,conceptIds:concepts.map((c)=>c.id)}:item)}};
    });
  }
  function saveQuestionSets(owner: WorkspaceTab, sets: QuestionSet[]) {
    updateProject(project.id,(p)=>{
      let next = replaceSurfaceSets(p,owner,sets);
      for(const set of sets) if(!p.sets.some((existing)=>existing.id===set.id)) next=attachPaperNode(next,{id:`questions:${set.id}`,kind:"questions",objectId:set.id,parentId:owner.id,origin:"manual"});
      return next;
    });
  }
  function openBook(s: Source, requestedPage?: number) {
    if (requestedPage !== undefined) {
      const navigationId = `${project.id}:book:${s.id}`;
      setNavigationKeys((keys) => ({ ...keys, [navigationId]: (keys[navigationId] || 0) + 1 }));
    }
    setSelected("");
    setVisibleText("");
    setPageImage("");
    setEvidenceText("");
    updateProject(project.id, (p) => ({
      ...p,
      sources: p.sources.map((item) =>
        item.id === s.id
          ? { ...item, progress: requestedPage || Math.max(1, item.progress) }
          : item,
      ),
    }));
    openTab({ id: `book:${s.id}`, kind: "book", sourceId: s.id });
  }
  function onCitation(e: Evidence, origin: WorkspaceTab = visibleNode || tab) {
    if (readAnchor({...e,quote:e.text},origin))
      setToast(`已定位到「${e.title}」第 ${e.page} 页`);
  }
  function currentReaderPage(target: WorkspaceTab, comparison = false) {
    const document = documentForTarget(project,target);
    const node = treeNodes.find((item)=>item.id===target.id);
    const key = `${project.id}:${comparison ? "reference:" : ""}${target.id}`;
    return comparison ? documentPage(document,referencePages[key] || node?.progress || node?.anchor?.page || document?.progress) : documentPage(document);
  }
  function rememberReadingVisit() {
    const readers: ReadingVisit["readers"] = [];
    for (const [target, comparison] of [[tab, false], ...(comparisonOpen ? [[companionNode, true]] : [])] as Array<[WorkspaceTab, boolean]>) {
      if (target.kind !== "book") continue;
      const document = documentForTarget(project,target);
      if (!document) continue;
      const key = `${project.id}:${comparison ? "reference:" : ""}${target.id}`;
      const session = captureReaderSession(key);
      readers.push({target,key,comparison,page:session?.anchor?.page || currentReaderPage(target,comparison),session});
    }
    readingHistory.push(project.id,{main:tab,companionId,comparisonOpen,side:companionSide,expanded:companionExpanded,readers,evidenceText,
      referenceAnchors:Object.fromEntries(readers.filter((reader)=>referenceAnchors[reader.key]).map((reader)=>[reader.key,referenceAnchors[reader.key]]))});
    refreshReadingHistory((value)=>value+1);
  }
  function returnFromCitation() {
    const visit = readingHistory.take(project.id,(entry)=>treeNodes.some((node)=>node.id===entry.main.id)
      && entry.readers.every((reader)=>project.sources.some((source)=>source.id===reader.target.sourceId)));
    refreshReadingHistory((value)=>value+1);
    if (!visit) { setToast("之前的阅读内容已不可用。"); return; }
    const mainReader = visit.readers.find((reader)=>!reader.comparison);
    const mainSource = mainReader && documentForTarget(project,mainReader.target);
    openTab(visit.main,mainReader && mainSource ? {sourceId:mainSource.id,title:mainSource.title,page:mainReader.page} : undefined);
    const canRestoreCompanion = treeNodes.some((node)=>node.id===visit.companionId) || visit.companionId.startsWith("scope-chat:");
    setCompanions((previous)=>({...previous,[readingCompanionKey(project.id,visit.main.id)]:visit.companionId}));
    setWorkspaceView({mainId:visit.main.id,comparisonOpen:visit.comparisonOpen && canRestoreCompanion,side:visit.side});
    setFloatingObjects((previous)=>previous.filter((item)=>item.projectId!==project.id || (item.nodeId!==visit.main.id && !(visit.comparisonOpen && canRestoreCompanion && item.nodeId===visit.companionId))));
    setCompanionExpanded(visit.expanded);
    setEvidenceText(visit.evidenceText);
    for (const reader of visit.readers) {
      const navigationKey = (navigationKeys[reader.key] || 0)+1;
      const anchor = visit.referenceAnchors[reader.key];
      if (reader.comparison) {
        setReferencePages((previous)=>({...previous,[reader.key]:reader.page}));
        setReferenceAnchors((previous)=>{const next={...previous};if(anchor) next[reader.key]=anchor;else delete next[reader.key];return next;});
      }
      setNavigationKeys((previous)=>({...previous,[reader.key]:navigationKey}));
      restoreReaderSession(reader.key,reader.session,{sourceId:reader.target.sourceId,navigationKey,evidenceText:reader.comparison ? anchor?.quote : visit.evidenceText});
    }
  }
  function readAnchor(anchor: ReadingAnchor, origin: WorkspaceTab = visibleNode || tab) {
    const inReference = comparisonOpen && companionNode.kind === "book" && tab.kind !== "book";
    const destination = readingDestination(project,anchor,inReference ? companionId : tab.id);
    if (!destination) {
      setToast("原资料或页码不可用，请检查关联的阅读位置。");
      return false;
    }
    rememberReadingVisit();
    if (inReference) {
      const key = `${project.id}:reference:${destination.id}`;
      setReferencePages((previous)=>({...previous,[key]:anchor.page}));
      setReferenceAnchors((previous)=>({...previous,[key]:anchor}));
      setNavigationKeys((previous)=>({...previous,[key]:(previous[key] || 0)+1}));
      selectCompanion(destination.id);
      setCompanionExpanded(false);
      return true;
    }
    const retainCompanion = Boolean(comparisonOpen && origin.id === companionId && !companionOnly);
    openTab(destination,anchor);
    setSourceManagerOpen(false);
    setEvidenceText(anchor.quote || "");
    if (origin.kind !== "book") setReadingReturn({projectId:project.id,nodeId:origin.id});
    if (retainCompanion) {
      setCompanions((previous)=>({...previous,[readingCompanionKey(project.id,destination.id)]:origin.id}));
      setComparisonOpen(true);
    }
    // On a single-pane workspace the explicit source action must reveal the PDF.
    // The saved visit restores the conversation presentation when returning.
    if (companionOnly) { setComparisonOpen(false); setCompanionExpanded(false); }
    return true;
  }
  function applyProposal(proposal: ProjectProposal, messageId: string, owner: WorkspaceTab = tab) {
    const chatId = owner.kind === "chat" ? owner.objectId || owner.id : owner.id;
    updateProject(project.id, (p) => {
      if (
        p.chats
          .find((c) => c.id === chatId)
          ?.messages.find((m) => m.id === messageId)?.proposalApplied
      )
        return p;
      const { project: next, receipt } = createProjectUpdate(p, proposal);
      const branched = addProposalNodes(next, owner.id, messageId, proposal, receipt);
      return {
        ...branched,
        chats: branched.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        proposalApplied: true,
                        proposalUndo: receipt,
                        proposalReverted: undefined,
                      }
                    : m,
                ),
              }
            : c,
        ),
      };
    });
    setToast("已更新所属知识图谱和项目关卡，保留已有学习记录。");
  }
  function undoProposal(messageId: string, owner: WorkspaceTab = tab) {
    const chatId = owner.kind === "chat" ? owner.objectId || owner.id : owner.id;
    updateProject(project.id, (p) => {
      const message = p.chats
        .find((c) => c.id === chatId)
        ?.messages.find((m) => m.id === messageId);
      if (!message?.proposalApplied || !message.proposalUndo) return p;
      const { project: next, retained } = revertPaperProposal(p, message.proposalUndo, owner.id, messageId);
      return {
        ...next,
        chats: next.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        proposalApplied: false,
                        proposalUndo: undefined,
                        proposalReverted: { retained },
                      }
                    : m,
                ),
              }
            : c,
        ),
      };
    });
    setToast("已撤回可恢复的更新，保留后续修改与学习记录。");
  }
  function addSelectionBookmark(targetSource: Source, selectionPage: number, text: string) {
    if (!text.trim()) return;
    updateProject(project.id,(current)=>saveDocumentBookmark(current,{
      id:crypto.randomUUID(),sourceId:targetSource.id,page:selectionPage,title:targetSource.title,quote:text,created:new Date().toISOString(),
    }));
    setToast("已保存选中文字和阅读位置。");
  }
  function toggleBookmark(targetSource: Source, targetPage: number) {
    updateProject(project.id,(current)=>toggleDocumentBookmark(current,{
      id:crypto.randomUUID(),sourceId:targetSource.id,page:targetPage,title:targetSource.title,created:new Date().toISOString(),
    }));
  }
  function updateMessages(chatId: string, change: (messages: Message[]) => Message[], originId = tab.id, scopeId = tab.id) {
    // Keep callbacks bound to the conversation that produced this result.
    updateProject(project.id, (p) => {
      if (!p.chats.some((item)=>item.id===chatId) && chatId.startsWith("scope-chat:"))
        p = ensureScopeConversation(p,scopeId,chatId).project;
      const chat = p.chats.find((item)=>item.id===chatId);
      if (!chat) return p;
      const messages = change(chat.messages).slice(-100);
      const previousIds = new Set(chat.messages.map((message)=>message.id));
      const addedMessages = messages.filter((message)=>!previousIds.has(message.id));
      const lastInteractionAt = addedMessages.some((message)=>message.role==="user") ? new Date().toISOString() : chat.lastInteractionAt;
      let next = {...p,chats:p.chats.map((item)=>item.id===chatId?{...item,messages,lastInteractionAt}:item)};
      for (const message of addedMessages) next = persistMessagePractice(next,originId,message);
      return capturePaperResults(next,originId,addedMessages);
    });
  }
  function setChatTitle(chatId: string, title: string, scopeId?: string) {
    updateProject(project.id, (p) => {
      if (scopeId && chatId.startsWith("scope-chat:") && !p.chats.some((chat)=>chat.id===chatId))
        p=ensureScopeConversation(p,scopeId,chatId).project;
      return {...p,chats:p.chats.map((c)=>(c.id===chatId ? {...c,title} : c))};
    });
  }
  function beginProjectEdit(mode: "new" | "edit") {
    setProjectEdit(mode);
    setNameDraft(mode === "edit" ? project.name : "");
    setGoalDraft(mode === "edit" ? project.goal : "");
  }
  function newQuestionSet() {
    const id = crypto.randomUUID();
    const node: PaperNode = {id:`questions:${id}`,kind:"questions",objectId:id,parentId:"questions",origin:"manual"};
    updateProject(project.id, (p) => attachPaperNode({...p,sets:[...p.sets,{id,title:"自编练习",description:"",questions:[],origin:"manual",presentation:"collection",scopeNodeId:p.paperTree?.tutorId}],tabs:[...p.tabs,node]},node));
    floatObject(node);
  }
  function requestPractice(scopeId: string, purpose: "check" | "practice" | "textbook") {
    const owner = scopeId === "project" ? project.paperTree?.tutorId : scopeId;
    if (!owner) return;
    const id = createBranch(owner,"","",[],undefined,true);
    if (!id) return;
    const chapter = treeNodes.find((node) => node.id === owner && node.role === "chapter");
    const scopeName = chapter ? nodeTitle(project,chapter) : "项目资料和学习目标";
    setChatTitle(id,chapter ? `${scopeName} · 练习` : "项目练习");
    const request = purpose === "textbook"
      ? `请从${scopeName}中查找教材原有习题，保留原题编号和页码，整理为可作答的习题文件。原书未给答案时标记待核对，不编造标准答案。`
      : purpose === "practice"
        ? `请围绕${scopeName}生成一份循序渐进的练习文件，根据内容选择合适题量，覆盖关键关系并给出提示。`
        : `请围绕${scopeName}，用一两道小题检验我的理解，给出可按需查看的提示。`;
    tutorSessions.setDraft(`${project.id}:${id}`,`${request}请用出题工具生成可直接作答的练习；答案和解析在提交后再展示。`);
    setComposerFocus({nodeId:id,key:crypto.randomUUID()});
  }
  function navigateToOrigin(origin: WorkspaceTab, navigate: (target: WorkspaceTab)=>void) {
    if (workspaceContentLocation(currentPlacement(),origin.id)) presentContent(origin,"right",true);
    else navigate(origin);
  }
  function openPracticeOrigin(entry: PracticeEntry, navigate: (target: WorkspaceTab)=>void) {
    const origin = treeNodes.find((node) => node.id === entry.originNodeId);
    if (!origin) return;
    navigate(origin);
    if (entry.sourceMessageId) setMessageFocus({nodeId:origin.id,messageId:entry.sourceMessageId,key:Date.now()});
  }
  function openQuestionSetOrigin(set: QuestionSet, navigate: (target: WorkspaceTab)=>void = openPrimary) {
    const node = treeNodes.find((item) => item.kind === "questions" && item.objectId === set.id);
    const origin = treeNodes.find((item) => item.id === node?.parentId);
    if (!origin || !set.sourceMessageId) return;
    navigate(origin);
    setMessageFocus({nodeId:origin.id,messageId:set.sourceMessageId,key:Date.now()});
  }
  function renderPracticeOverview(navigate: (target: WorkspaceTab)=>void) {
    return <PracticeOverview project={project} onGenerate={requestPractice} onCreateSet={newQuestionSet}
      onManageSet={(setId) => floatObject({id:`questions:${setId}`,kind:"questions",objectId:setId})}
      onOrigin={(entry)=>openPracticeOrigin(entry,navigate)} onAttempt={recordAttempt} onDraft={recordQuestionDraft}
      onOpenObject={(entry)=>openObject(entry.object,entry.sourceMessageId || "",entry.evidence,treeNodes.find((node)=>node.id===entry.originNodeId) || {id:"questions",kind:"questions"})}
      onCitation={(evidence) => onCitation(evidence,{id:"questions",kind:"questions"})}/>;
  }
  const searchResults = useMemo(() => findSourcePages(project.sources, query), [project.sources, query]);
  function renderTutor(standalone: boolean, embedded = false, target: WorkspaceTab = tab, navigate?: (target: WorkspaceTab)=>void) {
    const chatEntityId = target.kind === "chat" ? target.objectId || target.id : target.id;
    const targetNode = treeNodes.find((node)=>node.id===target.id) || (companionId===target.id ? companionNode : undefined);
    const activeChat = project.chats.find((chat)=>chat.id===chatEntityId) ||
      (chatEntityId.startsWith("scope-chat:") ? scopeConversation(project,targetNode?.parentId || tab.id,chatEntityId).chat : undefined);
    const directPaper = project.papers?.find((p) => p.id === chatEntityId);
    const savedContext = activeChat?.context;
    const liveObjectContext = savedContext?.objectNodeId ? objectConversationContext(project,savedContext.objectNodeId) : undefined;
    const context = liveObjectContext ? {...savedContext,...liveObjectContext,quote:savedContext?.quote ?? liveObjectContext.quote} : savedContext;
    const contextNode = treeNodes.find((node)=>node.id===(context?.parentId || targetNode?.parentId));
    const scopeIntroduction = context?.object?.kind === "source" && contextNode?.role === "chapter" && !context.sourceMessageId && !context.reading;
    const contextPaper = context && !scopeIntroduction && (context.quote || context.object || context.reading || context.sourceMessageId) ? {
      id:target.id,parentId:context.parentId,parentTitle:contextNode ? nodeTitle(project,contextNode) : "来源内容",parentTab:contextNode || target,
      title:activeChat?.title || "追问",sourceMessageId:context.sourceMessageId,
      object:context.object || {id:`context:${target.id}`,kind:"note" as const,title:"追问依据",content:context.quote || ""},evidence:context.evidence || [],created:"",
    } : undefined;
    const paper = directPaper || contextPaper;
    const conversation = conversationRoot(project,target.id);
    const hasOrigin = Boolean(contextPaper || (conversation && conversation.id !== target.id));
    const scope = activeChat?.context?.scopeNodeId ? {scopeNodeId:activeChat.context.scopeNodeId,sourceId:activeChat.context.sourceId} : discussionScope(project, target.id);
    const discussionSource = project.sources.find((item)=>item.id===scope.sourceId) || (scope.scopeNodeId===project.paperTree?.tutorId || !scope.scopeNodeId ? project.sources.find((item)=>item.id===project.activeSource) : undefined);
    const scopeNode = treeNodes.find((node)=>node.id===scope.scopeNodeId);
    const liveDocument = source || (comparisonOpen ? documentForTarget(project,companionNode) : undefined);
    const livePage = source ? page : referencePages[`${project.id}:reference:${companionId}`] || documentPage(liveDocument);
    const referenceSnapshot = referenceContent[`${project.id}:reference:${companionId}`];
    const liveText = source ? visibleText : referenceSnapshot?.page===livePage ? referenceSnapshot.text || "" : "";
    const liveImage = source ? pageImage : referenceSnapshot?.page===livePage ? referenceSnapshot.image || "" : "";
    const withinChapter = scopeNode?.role !== "chapter" || (livePage >= (scopeNode.anchor?.page || 1) && livePage <= (scopeNode.endPage || Infinity));
    const liveReading = Boolean(liveDocument && liveDocument.id === discussionSource?.id && withinChapter && !context?.objectNodeId && (!conversation || conversation.id === target.id));
    const reading = liveReading && liveDocument ? {
      sourceId:liveDocument.id,title:liveDocument.title,page:livePage,quote:source ? selected : "",visibleText:liveText,
    } : context?.reading;
    const scopeLabel = context?.reading ? undefined : scopeNode ? `对话范围 · ${nodeTitle(project,scopeNode)}` : discussionSource ? `整份资料 · ${discussionSource.title}` : undefined;
    return (
      <Tutor
        conversationTitle={activeChat?.title || "新对话"}
        projectId={project.id}
        referenceScope={referenceScope(project,scope.scopeNodeId,practiceEntries)}
        referenceConcepts={referenceConcepts}
        referenceGraphs={treeNodes.filter((node)=>node.graphConcepts && node.objectId).map((node)=>({id:node.objectId!,title:node.title || "对话图谱",concepts:node.graphConcepts!}))}
        referenceQuestions={practiceEntries.map((entry)=>entry.object)}
        objectReferences={Object.fromEntries([...project.sets.flatMap((set)=>set.questions.map((question)=>{const id=questionObject(set.id,question).id;return [id,id];})),...(project.papers || []).map((paper)=>[paper.object.id,paper.id]),...treeNodes.filter((node)=>node.graphConcepts && node.objectId).map((node)=>[node.objectId!,node.id])])}
        pendingConcept={pendingConcept?.nodeId===target.id ? pendingConcept : undefined}
        pendingQuestion={pendingQuestion?.nodeId===target.id ? pendingQuestion : undefined}
        onConsumeQuestion={()=>setPendingQuestion(undefined)}
        sessionKey={`${project.id}:${chatEntityId}`}
        onBranch={(quote,messageId,evidence)=>createBranch(target.id,quote,messageId,evidence,activeChat?.messages.find((m)=>m.id===messageId)?.readingContext || context?.reading,false,navigate)}
        focusMessageId={messageFocus?.nodeId===target.id ? messageFocus.messageId : undefined}
        focusMessageKey={messageFocus?.nodeId===target.id ? messageFocus.key : undefined}
        focusComposerKey={composerFocus?.nodeId===target.id ? composerFocus.key : undefined}
        onComposerFocused={clearComposerFocus}
        readingFixed={Boolean(reading && !liveReading)}
        readingEnabled={Boolean(reading)}
        scopeLabel={scopeLabel}
        branchContext={context && targetNode && hasOrigin ? {title:contextNode ? nodeTitle(project,contextNode) : "来源内容",quote:context.quote,onReturn:()=>returnToParent(targetNode,navigate)} : undefined}
        projectState={{ concepts: project.concepts, stages: project.stages }}
        attempts={project.attempts || []}
        questionSets={project.sets}
        onOpenQuestionSet={(setId) => floatObject({id:`questions:${setId}`,kind:"questions",objectId:setId})}
        drafts={project.questionDrafts}
        onDraft={recordQuestionDraft}
        paperContext={
          paper
            ? { ...paper, object: resolvePaperObject(project, paper) }
            : undefined
        }
        onOpenObject={(object,messageId,evidence)=>openObject(object,messageId,evidence,target)}
        onOpenConversationGraph={(graph)=>floatObject({id:conversationGraphNodeId(target.id,graph.id),kind:"graph",objectId:graph.id})}
        onAttempt={recordAttempt}
        onApplyProposal={(proposal,messageId)=>applyProposal(proposal,messageId,target)}
        onUndoProposal={(messageId)=>undoProposal(messageId,target)}
        onReadAnchor={(anchor)=>readAnchor(anchor,target)}
        onOpenProjectObject={(kind) => {
          if (kind === "graph") openScopeGraph(target.id);
          else floatObject({id:"path",kind:"path"});
        }}
        key={`${project.id}:${target.id}`}
        standalone={standalone}
        embedded={embedded}
        messages={activeChat?.messages || []}
        onMessages={(change) => updateMessages(chatEntityId, change,target.id,scope.scopeNodeId || targetNode?.parentId || tab.id)}
        onTitle={(title) => setChatTitle(chatEntityId, title,scope.scopeNodeId || targetNode?.parentId || tab.id)}
        sources={discussionSources(project,scope)}
        source={reading ? project.sources.find((item)=>item.id===reading.sourceId) : discussionSource}
        page={reading?.page || 1}
        selected={reading?.quote || ""}
        visibleText={reading?.visibleText || ""}
        pageImage={liveReading ? liveImage : ""}
        clearSelection={() => setSelected("")}
        mode={discussionSource ? "learning" : "project"}
        onClose={() => setComparisonOpen(false)}
        onCitation={(e)=>onCitation(e,target)}
        onSettings={() => setSettings(true)}
        configured={configured}
        goal={project.goal}
      />
    );
  }
  function renderConversationWorkspace(target: WorkspaceTab, companion = false, navigate: (target: WorkspaceTab)=>void = companion ? (next)=>selectCompanion(next.id) : openPrimary) {
    return <ConversationWorkspace project={project} targetId={target.id}
      onOpen={navigate}>
      {renderTutor(!companion,companion,target,navigate)}
    </ConversationWorkspace>;
  }
  function renderLearningSurface(target: WorkspaceTab, presentation: "main" | "comparison" | "floating", navigate: (target: WorkspaceTab)=>void) {
    const {node,concepts} = surfaceContent(project,target);
    const navigateOrigin = presentation === "floating" ? navigate : (origin: WorkspaceTab)=>navigateToOrigin(origin,navigate);
    return <LearningSurface key={`${project.id}:${target.id}`} project={project} target={target} presentation={presentation}
      graphState={graphStatus(node,concepts)} overview={renderPracticeOverview(navigateOrigin)}
      onNavigate={navigate}
      onGraphOrigin={(graphNode)=>{
        const origin = treeNodes.find((node)=>node.id===graphNode.parentId);
        if (!origin || !graphNode.sourceMessageId) return;
        navigateOrigin(origin);
        setMessageFocus({nodeId:origin.id,messageId:graphNode.sourceMessageId,key:Date.now()});
      }}
      onObjectOrigin={(paper)=>{
        const origin = treeNodes.find((node)=>node.id===(paper.parentId || paper.parentTab?.id));
        if (!origin || !paper.sourceMessageId) return;
        navigateOrigin(origin);
        setMessageFocus({nodeId:origin.id,messageId:paper.sourceMessageId,key:Date.now()});
      }}
      onReadAnchor={(anchor)=>readAnchor(anchor,target)} onCitation={(evidence)=>onCitation(evidence,target)}
      onReferenceConcept={(id)=>referenceConcept(id,target.id)} onReferenceQuestion={(object)=>referenceQuestion(object,target.id)} onAskObject={()=>askObject(target)} onAskQuestion={(object)=>askObject(target,object)} onConcepts={(next)=>saveConceptSubset(node,next)}
      onEditStage={(stage)=>{setStageEdit(stage);setStageEditTargetId(target.id);}} onToggleStage={(id)=>patch({stages:project.stages.map((stage)=>stage.id===id ? {...stage,done:!stage.done} : stage)})}
      onRemoveStage={(id)=>updateProject(project.id,(current)=>removeStage(current,id))} onEditGoal={()=>beginProjectEdit("edit")}
      onSets={(sets)=>saveQuestionSets(target,sets)} onSetOrigin={(set)=>openQuestionSetOrigin(set,navigateOrigin)}
      onAttempt={recordAttempt} onDraft={recordQuestionDraft}
      onPosition={(setId,questionId)=>updateProject(project.id,(current)=>({...current,practicePositions:{...current.practicePositions,[setId]:questionId}}))}
      onOpenObject={(object)=>openObject(object,"",[],target)} />;
  }
  function renderReader(target: WorkspaceTab, comparison = false) {
    const node = treeNodes.find((item)=>item.id===target.id);
    const document = documentForTarget(project,target);
    const sessionKey = `${project.id}:${comparison ? "reference:" : ""}${target.id}`;
    const currentPage = currentReaderPage(target,comparison);
    const reading = (at=currentPage,quote="") => document ? {sourceId:document.id,title:document.title,page:at,quote,
      visibleText:comparison ? referenceContent[sessionKey]?.page===at ? referenceContent[sessionKey].text : undefined : at===page ? visibleText : undefined} : undefined;
    return <Suspense fallback={<div className="empty-state"><Loader2 className="spin"/>打开阅读器…</div>}>
      <Reader key={sessionKey} sessionKey={sessionKey} source={document} page={currentPage}
        pageRange={node?.role === "chapter" ? {start:node.anchor?.page || 1,end:node.endPage || document?.pages.length || 1} : undefined}
        navigationKey={navigationKeys[sessionKey] || 0}
        evidenceText={comparison ? referenceAnchors[sessionKey]?.page===currentPage ? referenceAnchors[sessionKey].quote : undefined : evidenceText}
        returnTo={readingHistory.peek(project.id) ? {title:"返回刚才阅读",onReturn:returnFromCitation}
          : !comparison && returnNode ? {title:returnNode.kind==="chat" ? "返回对话" : `返回${surfaceDefinition(returnNode.kind)?.title || "内容"}`,onReturn:()=>openTab(returnNode)} : undefined}
        onPage={(next)=>{
          if (comparison) setReferencePages((previous)=>({...previous,[sessionKey]:next}));
          else {
            updateProject(project.id,(current)=>recordDocumentPosition(current,target,next));
            setSelected("");setEvidenceText("");setVisibleText("");setPageImage("");
          }
        }}
        onOutline={(outline)=>document && updateProject(project.id,(current)=>({...current,sources:current.sources.map((item)=>item.id===document.id && item.outline===undefined ? {...item,outline} : item)}))}
        onVisibleText={comparison ? (text,at)=>setReferenceContent((previous)=>previous[sessionKey]?.page===at && previous[sessionKey].text===text ? previous : {...previous,[sessionKey]:{...(previous[sessionKey]?.page===at ? previous[sessionKey] : {}),page:at,text}}) : setVisibleText}
        onPageImage={comparison ? (image,at)=>setReferenceContent((previous)=>previous[sessionKey]?.page===at && previous[sessionKey].image===image ? previous : {...previous,[sessionKey]:{...(previous[sessionKey]?.page===at ? previous[sessionKey] : {}),page:at,image}}) : setPageImage}
        onSelection={(text,at)=>document && askReading(target,reading(at,text))}
        bookmarked={!!document && !!pageBookmark(project,document.id,currentPage)} bookmarks={project.bookmarks}
        onBookmark={()=>document && toggleBookmark(document,currentPage)}
        onBookmarkSelection={(text,at)=>document && addSelectionBookmark(document,at,text)}
        tutorOpen={comparisonOpen && companionNode.kind==="chat"} onTutor={()=>document && askReading(target,reading())}/>
    </Suspense>;
  }
  function renderObjectReference(companionId: string, navigate: (target: WorkspaceTab)=>void = (target)=>selectCompanion(target.id), presentation: "comparison" | "floating" = "comparison") {
    const referenceNode = treeNodes.find((node)=>node.id===companionId) || (companionNode.id===companionId ? companionNode : undefined);
    if (!referenceNode) return null;
    if (referenceNode.kind === "book") return renderReader(referenceNode,true);
    return referenceNode.kind === "chat" ? renderConversationWorkspace(referenceNode,true,navigate) : renderLearningSurface(referenceNode,presentation,navigate);
  }
  const readingHome = defaultReadingTarget(project, tab.id);
  const navigationControl = <>
<button className="icon-button desktop-sidebar-toggle" data-study-focus aria-label={sidebarCollapsed ? "展开项目导航" : "收起项目导航"} aria-expanded={!sidebarCollapsed} onClick={()=>{
            setSidebarCollapsed(!sidebarCollapsed);
            localPreferences.setJSON(persistenceKeys.treeCollapsed,!sidebarCollapsed);
          }}><PanelLeft size={18}/></button>
          <button className="icon-button mobile-menu" aria-label="打开项目导航" aria-controls="project-navigation" aria-expanded={sidebar} onClick={(event)=>{sidebarTrigger.current=event.currentTarget;setSidebar(true);}}><PanelLeft size={18}/></button>
  </>;
  const primaryToolbar = (
        <header className="topbar project-topbar tree-topbar surface-heading">
          {navigationControl}
          <div className="paper-location paper-location-title" aria-label="当前位置"
            draggable={Boolean(currentNode)} title="拖到中央作为主视觉，拖到左右边缘并列"
            onDragStart={(event)=>{if(currentNode) writeWorkspaceTransfer(event.dataTransfer,project.id,currentNode.id,activeTitle,surfaceDefinition(currentNode.kind) ? "card" : "paper");}}>
            <small className="content-type-label">{contentTypeLabel(tab)}</small>
            <span>{currentNode ? objectWindowTitle(currentNode) : tabTitle(tab,project)}</span>
          </div>

          <div className="project-top-actions">
            {tab.kind === "chat" && <ConversationPaperNavigation project={project} targetId={tab.id} onOpen={openPrimary}/>}
            {tab.kind !== "book" && readingHome && <button className="pane-return" onClick={()=>openNavigation(readingHome)} title="返回原文"><ArrowLeft size={14}/><span>原文</span></button>}
            {currentNode && <ContentViewMenu title={activeTitle} current="main" canMoveToSide={comparisonOpen} canFloat={comparisonOpen || Boolean(readingHome && readingHome.id!==tab.id)} onPlace={(position)=>presentContent(currentNode,position)} />}
            <ActionMenu key={`${project.id}:${visibleId}`} label="更多操作" trigger={<MoreHorizontal size={19}/>}>
              <button onClick={()=>setSearchOpen(true)}><Search size={15}/>搜索项目知识<kbd>⌘ K</kbd></button>
              <div className="action-menu-divider"/>
              <div className="action-menu-label">当前内容</div>
              <button onClick={newChat}><MessageSquare size={15}/>{visibleNode?.kind === "chat" ? "新建追问" : "新建对话"}</button>
            </ActionMenu>
          </div>
        </header>
  );
  if (loadError)
    return (
      <div className="app-loading load-error" role="alert">
        <BookOpen size={28} />
        <h1>暂时无法打开本机项目</h1>
        <p>{loadError}</p>
        <p>已停止自动保存，避免覆盖已有资料。</p>
        <button
          className="button primary"
          onClick={() => setLoadRevision((v) => v + 1)}
        >
          重试读取
        </button>
      </div>
    );
  if (!ready)
    return (
      <div className="app-loading">
        <BookOpen size={28} />
        <span>打开项目…</span>
      </div>
    );
  return (
    <div
      className={`app compact-app paper-tree-app reading-workbench ${source ? "is-reading" : ""} ${source && !comparisonOpen ? "reading-focused" : ""} ${sidebar ? "sidebar-open" : ""} ${sidebarDragging ? "sidebar-dragging" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      {sidebar && (
        <div className="sidebar-scrim" onClick={closeSidebar} />
      )}
      <aside ref={sidebarElement} id="project-navigation" className="sidebar project-sidebar" aria-label="项目导航">
        <div className="sidebar-brand-row">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <BookOpen size={21} strokeWidth={1.6} />
          </span>
          <span>
            SideReader<span className="brand-period">.</span>
          </span>
        </a>
        <button ref={sidebarClose} className="icon-button mobile-sidebar-close" aria-label="关闭项目导航" title="关闭项目导航" onClick={closeSidebar}><X size={20}/></button>
        </div>
        <div className="tree-project-picker">
          <select aria-label="切换项目" value={project.id} onChange={(event)=>{
            const id=event.target.value;
            setStore((previous)=>({...previous,projects:previous.projects.map((item)=>item.id===id ? restoreWorkspaceProject(item,workspaceViews[id]?.mainId) : item),activeProjectId:id}));
            setSelected("");setEvidenceText("");setVisibleText("");setPageImage("");setCompanionExpanded(false);
          }}>{store.projects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <ActionMenu label="项目操作" trigger={<MoreHorizontal size={17}/>}>
            <button onClick={()=>beginProjectEdit("new")}><FolderPlus size={15}/>新建项目</button>
            <button onClick={()=>beginProjectEdit("edit")}><Settings2 size={15}/>项目设置</button>
          </ActionMenu>
        </div>
        <PaperTree project={project} activeId={visibleId} secondaryId={comparisonOpen && !companionOnly ? companionId : undefined} onOpen={openNavigation} onOpenSearch={(target,messageId)=>{openNavigation(target,false);if(messageId)setMessageFocus({nodeId:target.id,messageId,key:Date.now()});}} onOpenObject={openNavigation} onOpenPractice={(entry)=>openObject(entry.object,entry.sourceMessageId || "",entry.evidence,treeNodes.find((node)=>node.id===entry.originNodeId) || tab,"navigation")} onNewBranch={(parentId)=>createBranch(parentId,"","",[],undefined,true)} onImport={()=>setImportOpen(true)} onManageSources={()=>setSourceManagerOpen(true)} onCompare={compareObject} onOpenScopeGraph={openScopeGraph}/>
        <div className="sidebar-bottom">
          <ThemeToggle />
          <button className="settings-link" onClick={() => setSettings(true)}>
            <Settings2 size={16} />
            <span>模型设置</span>
            <span className={`status-dot ${configured ? "online" : ""}`} />
          </button>
          <div className="project-local" aria-live="polite">
            <span
              className={`status-dot ${saveState === "saved" ? "online" : ""}`}
            />
            {saveState === "saved"
              ? "已保存在本机"
              : saveState === "saving"
                ? "正在保存…"
                : "保存失败"}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        {saveState === "error" && (
          <div className="save-error-banner" role="alert">
            <span>
              最新修改尚未保存。请保留此页面，检查 Safari 存储空间后重试。
            </span>
            <button
              className="button small"
              onClick={() => setSaveRevision((v) => v + 1)}
            >
              重试保存
            </button>
          </div>
        )}
        {project.stageRemoval && (tab.kind === "path" || visibleId === project.paperTree?.tutorId) && (
          <div className="stage-undo" role="status">
            <span>已移除「{project.stageRemoval.stage.title}」</span>
            <button className="button small" onClick={() => updateProject(project.id, restoreRemovedStage)}>
              撤销删除
            </button>
            <button className="icon-button" aria-label="关闭删除提示" onClick={() => patch({ stageRemoval: undefined })}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="project-content">
          <main className="project-main" key={project.id}>
              <StudyWorkspace
                open={comparisonOpen}
                expanded={companionExpanded}
                onOpenChange={setComparisonOpen}
                onExpandedChange={setCompanionExpanded}
                companionKind={companionNode?.kind}
                companionDraggable={treeNodes.some((node)=>node.id===companionId)}
                primaryKind={tab.kind}
                primaryId={tab.id}
                onContentFocus={(nodeId)=>setFocusedContent((previous)=>previous?.projectId===project.id && previous.nodeId===nodeId ? previous : {projectId:project.id,nodeId})}
                side={companionSide}
                projectId={project.id}
                onDropObject={dropObject}
                onPresentationChange={setCompanionOnly}
                primaryToolbar={primaryToolbar}
                navigationControl={navigationControl}
                companionToolbarContent={companionNode.kind === "chat" ? <ConversationPaperNavigation project={project} targetId={companionId} onOpen={(target)=>selectCompanion(target.id)}/> : undefined}
                selection={companionId}
                companionTitle={companionNode ? objectWindowTitle(companionNode) : "对照内容"}
                companionTypeLabel={contentTypeLabel(companionNode)}
                companion={renderObjectReference(companionId)}
              >
            {tab.kind === "chat" && (
              <div className="project-conversation">
                {renderConversationWorkspace(tab)}
              </div>
            )}
            {tab.kind === "book" && renderReader(tab)}
            {surfaceDefinition(tab.kind) && renderLearningSurface(tab,"main",openPrimary)}
              </StudyWorkspace>
          </main>
        </div>
        <div className="floating-object-layer">
          {floatingObjects.filter((item)=>item.projectId===project.id).map((item,index)=>{
            const node=treeNodes.find((candidate)=>candidate.id===item.nodeId);
            if(!node) return null;
            const close=()=>setFloatingObjects((previous)=>previous.filter((entry)=>entry!==item));
            const windowId=`${item.projectId}:${item.nodeId}`;
            return <FloatingObject key={windowId} id={windowId} projectId={project.id} nodeId={node.id} title={objectWindowTitle(node)} typeLabel={contentTypeLabel(node)} index={floatingOrder.includes(windowId) ? floatingOrder.indexOf(windowId) : index}
              toolbarContent={node.kind === "chat" ? <ConversationPaperNavigation project={project} targetId={node.id} onOpen={(target)=>navigateFromFloating(node.id,target)}/> : undefined}
              onFocus={()=>{raiseFloatingObject(windowId);setFocusedContent((previous)=>previous?.projectId===project.id && previous.nodeId===node.id ? previous : {projectId:project.id,nodeId:node.id});}}
              onClose={close} onDock={(position)=>presentContent(node,position)}>{renderObjectReference(node.id,(target)=>navigateFromFloating(node.id,target),"floating")}</FloatingObject>;
          })}
        </div>
      </div>
      {sourceManagerOpen && <Modal title="资料与书签" onClose={()=>setSourceManagerOpen(false)}>
        <div className="source-manager">
          <p>资料在项目导航中打开；这里管理导入文件与阅读书签。</p>
          {project.sources.map((item)=><div className="managed-source" key={item.id}><button onClick={()=>{setSourceManagerOpen(false);openBook(item);}}><BookOpen size={16}/><span>{item.title}<small>{item.pages.length} 页 · 第 {item.progress || 1} 页</small></span></button><button className="icon-button" aria-label={`移除${item.title}`} onClick={()=>{setSourceManagerOpen(false);setDeleteSource(item);}}><Trash2 size={14}/></button></div>)}
          <button className="button" onClick={()=>{setSourceManagerOpen(false);setImportOpen(true);}}><Plus size={15}/>添加资料</button>
          <h3>阅读书签</h3>
          {!project.bookmarks?.length && <p>在阅读工具栏收藏当前位置。</p>}
          {project.bookmarks?.map((bookmark)=><button className="bookmark-entry" key={bookmark.id} onClick={()=>readAnchor(bookmark)}>{bookmark.title} · 第 {bookmark.page} 页</button>)}
        </div>
      </Modal>}
      {settings && (
        <SettingsModal
          onClose={() => setSettings(false)}
          onSaved={(c) => setConfigured(c.configured)}
        />
      )}
      {importOpen && (
        <ImportModal
          configured={configured}
          onClose={() => setImportOpen(false)}
          onImport={(s) => {
            const needsProject = s.kind === "pdf" && project.sources.some((source)=>source.kind==="pdf");
            if (needsProject) {
              const next=enterReadingProject(normalizePaperTree({...newProject(s.title,""),sources:[s],activeSource:s.id}));
              setStore((current)=>({...current,projects:[...current.projects,next],activeProjectId:next.id}));
            } else {
              updateProject(project.id,(p)=>enterReadingProject(attachPaperNode({...p,sources:[...p.sources,s],activeSource:s.id}, {id:`book:${s.id}`,kind:"book",sourceId:s.id,parentId:p.paperTree?.rootId || null,origin:"import"})));
              setWorkspaceView({mainId:`book:${s.id}`,comparisonOpen:true,side:"right"});
            }
            setImportOpen(false);
            setCompanionExpanded(false);
            setToast(needsProject ? `已为「${s.title}」新建阅读项目` : `已添加「${s.title}」`);
          }}
        />
      )}
      {projectEdit && (
        <Modal
          title={projectEdit === "new" ? "新建项目" : "项目设置"}
          onClose={() => setProjectEdit(null)}
        >
          <label>
            项目名称
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="例如：深入理解 Agent"
              maxLength={40}
            />
          </label>
          <label>
            学习目标
            <textarea
              rows={3}
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              placeholder="你想通过这个项目学会什么？"
            />
          </label>
          <div className="modal-actions">
            {projectEdit === "edit" && store.projects.length > 1 && (
              <button
                className="text-button danger"
                style={{ marginRight: "auto" }}
                onClick={() => {
                  setProjectEdit(null);
                  setDeleteProject(true);
                }}
              >
                删除项目
              </button>
            )}
            <button
              className="button primary"
              disabled={!nameDraft.trim()}
              onClick={() => {
                if (projectEdit === "new") {
                  const p = normalizePaperTree(newProject(nameDraft.trim(), goalDraft));
                  setStore((s) => ({
                    ...s,
                    projects: [...s.projects, p],
                    activeProjectId: p.id,
                  }));
                  setSourceManagerOpen(false);
                } else patch({ name: nameDraft.trim(), goal: goalDraft });
                setProjectEdit(null);
                setSidebar(false);
              }}
            >
              <Check size={15} />
              {projectEdit === "new" ? "创建项目" : "保存"}
            </button>
          </div>
        </Modal>
      )}
      {deleteProject && (
        <Modal title="删除项目" onClose={() => setDeleteProject(false)}>
          <p className="modal-intro">
            删除「{project.name}」及其对话、知识来源和学习对象？
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDeleteProject(false)}>
              取消
            </button>
            <button
              className="button danger-button"
              onClick={() => {
                project.sources
                  .filter((s) => s.kind === "pdf")
                  .forEach((s) => void removePdf(s.id));
                const projects = store.projects.filter(
                  (p) => p.id !== project.id,
                );
                setStore({
                  ...store,
                  projects,
                  activeProjectId: projects[0].id,
                });
                setDeleteProject(false);
              }}
            >
              删除项目
            </button>
          </div>
        </Modal>
      )}
      {stageEdit && (
        <Modal title="编辑关卡" onClose={() => setStageEdit(null)}>
          <label>
            关卡名称
            <input
              autoFocus
              value={stageEdit.title}
              onChange={(e) =>
                setStageEdit({ ...stageEdit, title: e.target.value })
              }
            />
          </label>
          <label>
            任务说明
            <textarea
              rows={3}
              value={stageEdit.description}
              onChange={(e) =>
                setStageEdit({ ...stageEdit, description: e.target.value })
              }
            />
          </label>
          <label>
            交付产物
            <textarea
              rows={2}
              value={stageEdit.deliverable || ""}
              placeholder="例如：一个能运行并解释结果的小实验"
              onChange={(e) =>
                setStageEdit({ ...stageEdit, deliverable: e.target.value })
              }
            />
          </label>
          <label>
            验收标准
            <textarea
              rows={2}
              value={stageEdit.check || ""}
              placeholder="如何判断这项任务完成了？"
              onChange={(e) =>
                setStageEdit({ ...stageEdit, check: e.target.value })
              }
            />
          </label>
          {project.stages.some((s) => s.id !== stageEdit.id) && (
            <fieldset className="stage-prerequisites">
              <legend>先修关卡</legend>
              {project.stages
                .filter((s) => s.id !== stageEdit.id)
                .map((s) => {
                  const checked =
                    stageEdit.prerequisites?.includes(s.id) || false;
                  const cyclic = prerequisiteWouldCycle(
                    project.stages,
                    stageEdit.id,
                    s.id,
                  );
                  return (
                    <label key={s.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={cyclic && !checked}
                        onChange={(e) =>
                          setStageEdit({
                            ...stageEdit,
                            prerequisites: e.target.checked
                              ? [...(stageEdit.prerequisites || []), s.id]
                              : (stageEdit.prerequisites || []).filter(
                                  (id) => id !== s.id,
                                ),
                          })
                        }
                      />
                      <span>
                        {s.title}
                        {cyclic && !checked ? "（会形成循环依赖）" : ""}
                      </span>
                    </label>
                  );
                })}
            </fieldset>
          )}
          <label>
            标签
            <input
              value={stageEdit.tag}
              onChange={(e) =>
                setStageEdit({ ...stageEdit, tag: e.target.value })
              }
            />
          </label>
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={!stageEdit.title.trim()}
              onClick={() => {
                updateProject(project.id, (p) => {
                  const current = p.stages.find((s) => s.id === stageEdit.id);
                  const updated = {
                    ...stageEdit,
                    title: stageEdit.title.trim(),
                    done: current?.done ?? stageEdit.done,
                    anchors: current?.anchors ?? stageEdit.anchors,
                    prerequisites: (stageEdit.prerequisites || []).filter(
                      (id) =>
                        p.stages.some((s) => s.id === id) &&
                        !prerequisiteWouldCycle(p.stages, stageEdit.id, id),
                    ),
                  };
                  return {
                    ...p,
                    stages: current
                      ? p.stages.map((s) => (s.id === updated.id ? updated : s))
                      : [...p.stages, updated],
                    paperTree: p.paperTree && stageEditTargetId ? {...p.paperTree,nodes:p.paperTree.nodes.map((node)=>node.id===stageEditTargetId && node.stageIds ? {...node,stageIds:[...new Set([...node.stageIds,updated.id])]}:node)} : p.paperTree,
                  };
                });
                setStageEdit(null);
              }}
            >
              保存关卡
            </button>
          </div>
        </Modal>
      )}
      {deleteSource && (
        <Modal title="移除知识来源" onClose={() => setDeleteSource(null)}>
          <p className="modal-intro">
            移除「{deleteSource.title}」及其索引？相关图谱和练习保留。
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDeleteSource(null)}>
              取消
            </button>
            <button
              className="button danger-button"
              onClick={() => {
                if (deleteSource.kind === "pdf")
                  void removePdf(deleteSource.id).catch(() =>
                    setToast("PDF 清理失败。"),
                  );
                updateProject(project.id,(current)=>removeDocument(current,deleteSource.id));
                setDeleteSource(null);
              }}
            >
              确认移除
            </button>
          </div>
        </Modal>
      )}
      {searchOpen && (
        <Modal
          title="搜索项目知识"
          onClose={() => {
            setSearchOpen(false);
            setQuery("");
          }}
        >
          <div className="global-search">
            <Search size={18} />
            <input
              autoFocus
              aria-label="搜索全部知识"
              placeholder="输入关键词…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="search-results">
            {query ? (
              searchResults.length ? (
                searchResults.map(({ s, c }) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      readAnchor({sourceId:s.id,title:s.title,page:c.page});
                      setEvidenceText(query.trim());
                      setSearchOpen(false);
                      setQuery("");
                    }}
                  >
                    <span>
                      <BookOpen size={14} />
                      {s.title}
                      <small>第 {c.page} 页</small>
                    </span>
                    <SourceEvidenceExcerpt text={c.text} sourceId={s.kind === "pdf" ? s.id : ""} page={c.page} query={query} />
                  </button>
                ))
              ) : (
                <div className="search-empty">没有匹配的内容。</div>
              )
            ) : (
              <div className="search-empty">
                搜索当前项目的 {project.sources.length} 个知识来源。
              </div>
            )}
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
