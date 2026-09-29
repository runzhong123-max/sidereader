import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowUp,
  X,
  BookOpen,
  ChevronRight,
  Settings2,
  Pin,
  PinOff,
  ArrowDown,
  CornerUpLeft,
  MessageSquarePlus,
  Trash2,
  Network,
  FileQuestion,
} from "lucide-react";
import type {
  Source,
  Message,
  Evidence,
  LearningObject,
  LearningAttempt,
  Paper,
  ProjectProposal,
  ResearchReport,
  ReadingAnchor,
  ReadingContext,
  QuestionSet,
  ConversationGraph,
} from "../types";
import { tutorRequest } from "../services/tutor";
import { CONCEPT_DRAG_MARKER, CONCEPT_DROP_MIME, MAX_CONCEPT_REFERENCES, questionWithConceptReferences, resolveConceptDrop, snapshotConceptReferences, snapshotReadingContext, tutorSessions } from "../tutor-sessions.mjs";
import type { ConceptReference, TutorViewport } from "../tutor-sessions.mjs";
import { QUESTION_DROP_MIME, MAX_QUESTION_REFERENCES, questionWithQuestionReferences, resolveQuestionDrop, snapshotQuestionReferences } from "../question-references.mjs";
import type { QuestionReference } from "../question-references.mjs";
import { filterScopeReferences, type ReferenceScope } from "../reference-scope.mjs";
import type { QuestionDraft } from "../question-state.mjs";
import ResearchResult from "./ResearchResult";
import ActionMenu from "./ActionMenu";
import PracticeMessage from "./PracticeMessage";
import ConversationGraphCard from "./ConversationGraphCard";
import EvidenceCitation from "./EvidenceCitation";
import SourceEvidenceExcerpt from "./SourceEvidenceExcerpt";
import ReferenceSnapshot from "./ReferenceSnapshot";
import "../tutor-continuity.css";
import "../concept-context.css";
import "../conversation-experience.css";
import { answerForPaper } from "../learning-objects.mjs";
const AnswerContent = lazy(() => import("./AnswerContent"));
import type { Concept, Stage } from "../types";

const readingBlocks = (message: Element) =>
  Array.from(message.querySelectorAll<HTMLElement>(
    ".answer-markdown > p, .answer-markdown > h1, .answer-markdown > h2, .answer-markdown > h3, .answer-markdown > ul, .answer-markdown > ol, .answer-markdown > figure, .answer-markdown > blockquote, .message-text, .learning-object-card",
  ));

// Returning to a source message is a navigation event, not a standing scroll
// preference. Switching away and back must not replay an already handled jump.
const handledMessageFocus = new Map<string, string>();
const emptyConcepts: Concept[] = [];
const emptyQuestions: LearningObject[] = [];
const emptyGraphs: ConversationGraph[] = [];

function selectedTextWithin(message: Element | undefined | null) {
  const selection = window.getSelection();
  if (!message || !selection || selection.isCollapsed ||
    !selection.anchorNode || !selection.focusNode ||
    !message.contains(selection.anchorNode) || !message.contains(selection.focusNode))
    return "";
  return selection.toString().trim();
}

export default function Tutor({
  sessionKey,
  sources,
  source,
  page,
  selected,
  clearSelection,
  mode,
  onClose,
  onCitation,
  onSettings,
  configured,
  goal,
  standalone = false,
  embedded = false,
  messages,
  onMessages,
  onTitle,
  visibleText,
  pageImage,
  projectState,
  attempts = [],
  paperContext,
  onOpenObject,
  onBranch,
  onAttempt,
  onApplyProposal,
  onUndoProposal,
  onReadAnchor,
  onOpenProjectObject,
  onOpenConversationGraph,
  drafts,
  onDraft,
  focusMessageId,
  focusMessageKey,
  focusComposerKey,
  onComposerFocused,
  branchContext,
  readingFixed = false,
  readingEnabled = true,
  scopeLabel,
  questionSets = [],
  onOpenQuestionSet,
  projectId,
  referenceConcepts = emptyConcepts,
  pendingConcept,
  referenceQuestions = emptyQuestions,
  referenceGraphs = emptyGraphs,
  referenceScope,
  pendingQuestion,
  onConsumeQuestion,
  objectReferences,
  conversationTitle,
}: {
  sessionKey: string;
  sources: Source[];
  source?: Source;
  page: number;
  selected: string;
  clearSelection: () => void;
  mode: "learning" | "project";
  onClose: () => void;
  onCitation: (e: Evidence) => void;
  onSettings: () => void;
  configured: boolean;
  goal: string;
  standalone?: boolean;
  embedded?: boolean;
  messages: Message[];
  onMessages: (update: (previous: Message[]) => Message[]) => void;
  onTitle: (title: string) => void;
  visibleText: string;
  pageImage: string;
  projectState?: { concepts: Concept[]; stages: Stage[] };
  attempts?: LearningAttempt[];
  paperContext?: Paper;
  onOpenObject?: (
    o: LearningObject,
    messageId: string,
    evidence: Evidence[],
  ) => void;
  onBranch?: (quote: string, messageId: string, evidence: Evidence[]) => void;
  onAttempt?: (a: LearningAttempt) => void;
  onApplyProposal?: (proposal: ProjectProposal, messageId: string) => void;
  onUndoProposal?: (messageId: string) => void;
  onReadAnchor?: (anchor: ReadingAnchor) => void;
  onOpenProjectObject?: (kind: "graph" | "path", messageId: string) => void;
  onOpenConversationGraph?: (graph: ConversationGraph) => void;
  referenceGraphs?: ConversationGraph[];
  drafts?: Record<string, QuestionDraft>;
  onDraft?: (objectId: string, draft: QuestionDraft) => void;
  focusMessageId?: string;
  focusMessageKey?: number;
  focusComposerKey?: string;
  onComposerFocused?: () => void;
  branchContext?: { quote?: string; title: string; onReturn: () => void };
  readingFixed?: boolean;
  readingEnabled?: boolean;
  scopeLabel?: string;
  questionSets?: QuestionSet[];
  onOpenQuestionSet?: (setId: string) => void;
  projectId?: string;
  referenceConcepts?: Concept[];
  pendingConcept?: { id: string; key: string };
  referenceQuestions?: LearningObject[];
  referenceScope?: ReferenceScope;
  pendingQuestion?: { id: string; key: string };
  onConsumeQuestion?: () => void;
  objectReferences?: Record<string, string>;
  conversationTitle?: string;
}) {
  const setMessages = onMessages;
  const citationCallback = useRef(onCitation);
  citationCallback.current = onCitation;
  const cite = useCallback((e: Evidence) => citationCallback.current(e), []);
  const session = useSyncExternalStore(
    useCallback(
      (listener) => tutorSessions.subscribe(sessionKey, listener),
      [sessionKey],
    ),
    useCallback(() => tutorSessions.read(sessionKey), [sessionKey]),
  );
  const { draft: input, busy, steps, lockedReading } = session;
  const setInput = (draft: string) => tutorSessions.setDraft(sessionKey, draft);
  const preferenceId = useId();
  const composer = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = composer.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.max(48, Math.min(144, field.scrollHeight))}px`;
  }, [input, sessionKey]);
  const conceptDropTarget = useRef<HTMLElement>(null);
  const dragDepth = useRef(0);
  const [conceptDragOver, setConceptDragOver] = useState(false);
  const [conceptNotice, setConceptNotice] = useState("");
  const [conceptWarning, setConceptWarning] = useState("");
  useEffect(() => {
    setConceptNotice("");
    setConceptWarning("");
    setConceptDragOver(false);
    dragDepth.current = 0;
  }, [sessionKey]);
  const scopedConcepts = useMemo(() => filterScopeReferences(referenceConcepts, referenceScope?.conceptIds), [referenceConcepts, referenceScope?.conceptIds]);
  const scopedQuestions = useMemo(() => filterScopeReferences(referenceQuestions, referenceScope?.questionIds), [referenceQuestions, referenceScope?.questionIds]);
  const selectedConcepts = snapshotConceptReferences(session.conceptIds, scopedConcepts);
  const selectedQuestions = snapshotQuestionReferences(session.questionIds, scopedQuestions);
  const receiveQuestion = useCallback((payload: unknown, deliveryKey?: string) => {
    const question = resolveQuestionDrop(payload, projectId, referenceQuestions);
    if (!question) {
      setConceptWarning("请引用当前项目中仍然存在的习题。");
      return false;
    }
    if (!scopedQuestions.some((item) => item.id === question.id)) {
      setConceptWarning("这道题不在当前对话范围内，请在它所属的项目或章节对话中引用。");
      return false;
    }
    const result = tutorSessions.addQuestion(sessionKey, question.id, deliveryKey);
    if (result === "handled") return true;
    if (result === "full") {
      setConceptWarning(`一次最多引用 ${MAX_QUESTION_REFERENCES} 道习题，请先移除一道。`);
      return false;
    }
    setConceptWarning("");
    setConceptNotice(`${result === "duplicate" ? "已在引用中" : "已引用"}：${question.title}`);
    composer.current?.focus({ preventScroll: true });
    return true;
  }, [projectId, referenceQuestions, scopedQuestions, sessionKey]);
  const referenceQuestion = (object: LearningObject) => receiveQuestion({
    version: 1, projectId, kind: "question", questionId: object.id,
  });
  const receiveConcept = useCallback((payload: unknown, deliveryKey?: string) => {
    const concept = resolveConceptDrop(payload, projectId, referenceConcepts);
    if (!concept) {
      setConceptWarning("请引用当前项目中仍然存在的概念。");
      return false;
    }
    if (!scopedConcepts.some((item) => item.id === concept.id)) {
      setConceptWarning("这个概念不在当前对话范围内，请在它所属的项目或章节对话中引用。");
      return false;
    }
    const result = tutorSessions.addConcept(sessionKey, concept.id, deliveryKey);
    if (result === "handled") return true;
    if (result === "full") {
      setConceptWarning(`一次最多引用 ${MAX_CONCEPT_REFERENCES} 个概念，请先移除一个。`);
      return false;
    }
    setConceptWarning("");
    setConceptNotice(`${result === "duplicate" ? "已在引用中" : "已引用"}：${concept.name}`);
    composer.current?.focus({ preventScroll: true });
    return true;
  }, [projectId, referenceConcepts, scopedConcepts, sessionKey]);

  useEffect(() => {
    const root = conceptDropTarget.current;
    if (!root) return;
    const onConceptDrop = (event: Event) => {
      event.stopPropagation();
      receiveConcept((event as CustomEvent).detail);
      setConceptDragOver(false);
      dragDepth.current = 0;
      delete root.dataset.conceptDragOver;
    };
    root.addEventListener("sidereader:concept-drop", onConceptDrop);
    return () => root.removeEventListener("sidereader:concept-drop", onConceptDrop);
  }, [receiveConcept]);

  useEffect(() => {
    if (pendingConcept) receiveConcept({
      version: 1, projectId, kind: "concept", conceptId: pendingConcept.id,
    }, pendingConcept.key);
  }, [pendingConcept?.id, pendingConcept?.key, projectId, receiveConcept]);

  useEffect(() => {
    if (!pendingQuestion) return;
    receiveQuestion({ version: 1, projectId, kind: "question", questionId: pendingQuestion.id }, pendingQuestion.key);
    onConsumeQuestion?.();
  }, [pendingQuestion?.id, pendingQuestion?.key, projectId, receiveQuestion, onConsumeQuestion]);

  useEffect(() => {
    const currentIds = tutorSessions.read(sessionKey).questionIds;
    const ids = snapshotQuestionReferences(currentIds, scopedQuestions).map((item) => item.id);
    if (ids.length !== currentIds.length) tutorSessions.setQuestionIds(sessionKey, ids);
  }, [sessionKey, session.questionIds, scopedQuestions]);

  useEffect(() => {
    // Deleted concepts cease to be available draft references. Persist only IDs;
    // current canonical descriptions are resolved when the user sends a question.
    const currentIds = tutorSessions.read(sessionKey).conceptIds;
    const ids = snapshotConceptReferences(currentIds, scopedConcepts).map((item) => item.id);
    if (ids.length !== currentIds.length) tutorSessions.setConceptIds(sessionKey, ids);
  }, [sessionKey, session.conceptIds, scopedConcepts]);
  useEffect(() => {
    if (!focusComposerKey) return;
    const frame = requestAnimationFrame(() => {
      composer.current?.focus();
      onComposerFocused?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusComposerKey, onComposerFocused]);
  const [imageMode, setImageMode] = useState<"auto" | "on" | "off">("auto");
  const conversation = useRef<HTMLDivElement>(null);
  const conversationContent = useRef<HTMLDivElement>(null);
  const viewport = useRef<TutorViewport | undefined>(
    tutorSessions.readViewport(sessionKey),
  );
  const followBottom = useRef(viewport.current?.followBottom ?? true);
  const restoringViewport = useRef(false);
  const restoreFrame = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const lastMessage = useRef(viewport.current?.lastMessageId);
  const [awayFromBottom, setAwayFromBottom] = useState(!followBottom.current);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [answerSelection, setAnswerSelection] = useState<{
    messageId: string; quote: string; top: number; left: number;
  } | null>(null);
  const [researchMode, setResearchMode] = useState<"auto" | "deep">("auto");
  const liveReading = readingEnabled && mode === "learning" && source
    ? { sourceId: source.id, title: source.title, page, quote: selected, visibleText }
    : undefined;
  const activeReading = !readingEnabled ? undefined : readingFixed ? liveReading : lockedReading?.context ?? liveReading;
  const activePageImage = !readingEnabled || readingFixed ? "" : lockedReading ? lockedReading.pageImage : pageImage;

  const saveViewport = useCallback(() => {
    const root = conversation.current;
    if (!root || restoringViewport.current) return;
    const rootTop = root.getBoundingClientRect().top;
    const message = Array.from(root.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((item) => item.getBoundingClientRect().bottom > rootTop + 4);
    const blocks = message ? readingBlocks(message) : [];
    const blockIndex = message && message.getBoundingClientRect().top < rootTop
      ? blocks.findIndex((item) => item.getBoundingClientRect().bottom > rootTop + 4)
      : -1;
    const target = blockIndex >= 0 ? blocks[blockIndex] : message;
    followBottom.current = root.scrollHeight - root.scrollTop - root.clientHeight < 60;
    const saved: TutorViewport = {
      messageId: message?.dataset.messageId,
      blockIndex: blockIndex >= 0 ? blockIndex : undefined,
      offset: target ? target.getBoundingClientRect().top - rootTop : 0,
      scrollTop: root.scrollTop,
      followBottom: followBottom.current,
      lastMessageId: messagesRef.current.at(-1)?.id,
    };
    viewport.current = saved;
    tutorSessions.saveViewport(sessionKey, saved);
    setAwayFromBottom(!followBottom.current);
    if (followBottom.current) setHasNewMessages(false);
  }, [sessionKey]);

  const restoreViewport = useCallback(() => {
    const root = conversation.current;
    if (!root || !root.clientHeight) return;
    restoringViewport.current = true;
    cancelAnimationFrame(restoreFrame.current);
    if (followBottom.current) {
      root.scrollTop = root.scrollHeight;
    } else {
      const saved = viewport.current;
      const message = Array.from(root.querySelectorAll<HTMLElement>("[data-message-id]"))
        .find((item) => item.dataset.messageId === saved?.messageId);
      const target = message && saved?.blockIndex !== undefined
        ? readingBlocks(message)[saved.blockIndex] ?? message
        : message;
      root.scrollTop = target && saved
        ? root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top - saved.offset
        : saved?.scrollTop ?? 0;
    }
    restoreFrame.current = requestAnimationFrame(() => {
      restoringViewport.current = false;
    });
  }, []);

  useLayoutEffect(() => {
    viewport.current = tutorSessions.readViewport(sessionKey);
    followBottom.current = viewport.current?.followBottom ?? true;
    lastMessage.current = viewport.current?.lastMessageId;
    setAwayFromBottom(!followBottom.current);
    restoreViewport();
    // The same paragraph remains in place when panel width, formulas or lazy
    // answer content change height. Native overflow anchoring is disabled here.
    const observer = new ResizeObserver(restoreViewport);
    if (conversation.current) observer.observe(conversation.current);
    if (conversationContent.current) observer.observe(conversationContent.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(restoreFrame.current);
    };
  }, [sessionKey, restoreViewport]);

  useLayoutEffect(() => {
    const latest = messages.at(-1)?.id;
    if (latest !== lastMessage.current && !followBottom.current)
      setHasNewMessages(true);
    lastMessage.current = latest;
    restoreViewport();
  }, [messages, busy, restoreViewport]);

  useLayoutEffect(() => {
    if (!focusMessageId) return;
    const focusRequest = JSON.stringify([focusMessageId, focusMessageKey ?? 0]);
    if (handledMessageFocus.get(sessionKey) === focusRequest) return;
    const root = conversation.current;
    const target = root && Array.from(root.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((item) => item.dataset.messageId === focusMessageId);
    if (!root || !target || !root.clientHeight) return;
    handledMessageFocus.set(sessionKey, focusRequest);
    followBottom.current = false;
    setAwayFromBottom(true);
    setHasNewMessages(false);
    restoringViewport.current = true;
    target.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" });
    target.focus({ preventScroll: true });
    // Store the requested start alignment even if lazy answer content has not
    // yet made the conversation tall enough. Its later resize restores this.
    const saved: TutorViewport = {
      messageId: focusMessageId,
      offset: 0,
      scrollTop: root.scrollTop,
      followBottom: false,
      lastMessageId: messages.at(-1)?.id,
    };
    viewport.current = saved;
    tutorSessions.saveViewport(sessionKey, saved);
    restoreViewport();
  }, [focusMessageId, focusMessageKey, sessionKey, messages, restoreViewport]);

  useEffect(() => {
    if (!onBranch && !onOpenObject) return;
    const root = conversation.current;
    function updateSelection() {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const focus = selection?.focusNode;
      const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
      const focusElement = focus instanceof Element ? focus : focus?.parentElement;
      const message = anchorElement?.closest<HTMLElement>(".message.assistant:not(.error)");
      const quote = selectedTextWithin(message);
      // The reader and answer metadata have their own selection behavior. This
      // action only belongs to answer text in this mounted conversation.
      if (!root || !message || !root.contains(message) || !quote ||
        !anchorElement?.closest(".answer-markdown") ||
        !focusElement?.closest(".answer-markdown") || !selection?.rangeCount) {
        setAnswerSelection(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const bounds = root.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom || !bounds.height) {
        setAnswerSelection(null);
        return;
      }
      setAnswerSelection({
        messageId: message.dataset.messageId!,
        quote,
        top: Math.max(bounds.top + 4, Math.min(rect.top - 38, bounds.bottom - 38)),
        left: Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - 126)),
      });
    }
    document.addEventListener("selectionchange", updateSelection);
    root?.addEventListener("scroll", updateSelection, { passive: true });
    window.addEventListener("resize", updateSelection);
    return () => {
      document.removeEventListener("selectionchange", updateSelection);
      root?.removeEventListener("scroll", updateSelection);
      window.removeEventListener("resize", updateSelection);
    };
  }, [sessionKey, onBranch, onOpenObject]);

  function branchFromMessage(message: Message, requireSelection = false) {
    const element = Array.from(conversation.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])
      .find((item) => item.dataset.messageId === message.id);
    const quote = selectedTextWithin(element);
    if (requireSelection && !quote) return;
    const content = quote || answerForPaper(message.content, message.id);
    if (onBranch) onBranch(content, message.id, message.evidence || []);
    else onOpenObject?.({
      id: `${message.id}:followup:${quote.slice(0, 120) || "full"}`,
      kind: "note",
      title: quote ? quote.slice(0, 32) : "继续追问",
      content,
    }, message.id, message.evidence || []);
  }

  function preserveSourcePosition() {
    const root = conversation.current;
    if (!root) return;
    // Expanding a source excerpt is a local reading action. Do not let the
    // resulting height change pull an otherwise empty branch to the bottom.
    followBottom.current = false;
    const saved: TutorViewport = {
      offset: 0,
      scrollTop: root.scrollTop,
      followBottom: false,
      lastMessageId: messages.at(-1)?.id,
    };
    viewport.current = saved;
    tutorSessions.saveViewport(sessionKey, saved);
  }

  function returnToLatest() {
    followBottom.current = true;
    setAwayFromBottom(false);
    setHasNewMessages(false);
    restoreViewport();
    const saved = {
      offset: 0,
      scrollTop: conversation.current?.scrollTop ?? 0,
      followBottom: true,
      lastMessageId: messages.at(-1)?.id,
    };
    viewport.current = saved;
    tutorSessions.saveViewport(sessionKey, saved);
  }

  function restartConversation() {
    if (!messages.length || window.confirm("清空当前辅导对话？阅读位置和项目资料会保留。")) {
      returnToLatest();
      setMessages(() => []);
      tutorSessions.setConceptIds(sessionKey, []);
      tutorSessions.setQuestionIds(sessionKey, []);
      setConceptWarning("");
    }
  }

  // Requests continue across tab switches; their messages stay with the originating chat.
  async function send(question = input, retryContext?: ReadingContext | null, retryConcepts?: ConceptReference[], retryQuestions?: QuestionReference[]) {
    if (!question.trim()) return;
    // Snapshot before any asynchronous work. A retried historical question must
    // not silently inherit the page the user happens to be reading now.
    const readingContext = snapshotReadingContext(
      retryContext === undefined ? activeReading : retryContext,
    );
    const requestImage = retryContext === undefined ? activePageImage : "";
    const conceptReferences = retryConcepts === undefined
      ? snapshotConceptReferences(tutorSessions.read(sessionKey).conceptIds, scopedConcepts)
      : snapshotConceptReferences(retryConcepts.map((item) => item.id), retryConcepts);
    const questionReferences = retryQuestions === undefined
      ? snapshotQuestionReferences(tutorSessions.read(sessionKey).questionIds, scopedQuestions)
      : snapshotQuestionReferences(retryQuestions.map((item) => item.id), retryQuestions);
    const request = tutorSessions.begin(sessionKey);
    if (!request) return;
    if (messages.length === 0) onTitle(question.trim().slice(0, 22));
    const user: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question.trim(),
      readingContext,
      ...(conceptReferences.length ? { conceptReferences } : {}),
      ...(questionReferences.length ? { questionReferences } : {}),
    };
    returnToLatest();
    setMessages((m) => [...m, user]);
    if (retryContext === undefined) {
      setInput("");
      tutorSessions.setConceptIds(sessionKey, []);
      tutorSessions.setQuestionIds(sessionKey, []);
      setConceptWarning("");
    }
    try {
      const data = await tutorRequest<{
        answer: string;
        evidence: Evidence[];
        routes: string[];
        mode: "model" | "retrieval";
        research: ResearchReport;
        proposal?: ProjectProposal;
        questionSets?: QuestionSet[];
        conversationGraphs?: ConversationGraph[];
      }>(
        {
          researchMode,
          question: questionWithQuestionReferences(questionWithConceptReferences(question, conceptReferences), questionReferences),
          sources: sources.map((s) => s.title),
          chunks: sources.flatMap((s) => s.chunks),
          anchor: readingContext
            ? { sourceId: readingContext.sourceId, page: readingContext.page }
            : null,
          selected: readingContext?.quote || "",
          visibleText: readingContext?.visibleText || "",
          pageImage:
            mode === "learning" &&
            configured &&
            requestImage &&
            (imageMode === "on" ||
              (imageMode === "auto" &&
                /图|表格|公式|示意|信息增益|熵|梯度|损失|矩阵|概率|函数|定理|推导|计算|diagram|chart|figure|equation|formula/i.test(
                  question,
                )))
              ? requestImage
              : undefined,
          mode,
          teachingStyle: "auto",
          projectState,
          attempts,
          paperContext,
          history: messages
            .filter((m) => !m.error)
            .map((m) => {
              const currentSets = m.questionSets?.map((saved) => questionSets.find((set) => set.id === saved.id) || saved);
              const practice = currentSets?.map((set) => `${set.title}\n${set.questions.map((q) => `${q.prompt}\n${q.options.join("；")}`).join("\n")}`).join("\n");
              const graphs = m.conversationGraphs?.map((saved) => referenceGraphs.find((graph)=>graph.id===saved.id) || saved)
                .map((graph)=>`${graph.title}\n${graph.concepts.map((concept)=>`${concept.id} ${concept.name}：${concept.description}；关联：${concept.links.join("、")}`).join("\n")}`).join("\n");
              return { role: m.role, content: questionWithQuestionReferences(questionWithConceptReferences(m.content, m.conceptReferences), m.questionReferences) + (practice ? `\n已生成练习：\n${practice}` : "") + (graphs ? `\n本次对话图谱：\n${graphs}` : "") };
            }),
          goal,
        },
        (step) => tutorSessions.progress(sessionKey, request, step),
        request.signal,
      );
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.answer,
          evidence: data.evidence,
          routes: data.routes,
          answerMode: data.mode,
          research: data.research,
          proposal: data.proposal,
          questionSets: data.questionSets,
          conversationGraphs: data.conversationGraphs,
          readingContext,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: request.signal.aborted
            ? "研究已停止。问题已保留，可以重新尝试。"
            : e instanceof Error
              ? e.message
              : "请求失败，请重试。",
          error: true,
          readingContext,
        },
      ]);
    } finally {
      tutorSessions.finish(sessionKey, request);
    }
  }
  return (
    <aside
      className={`tutor conversation-experience ${standalone ? "standalone" : ""} ${embedded ? "is-embedded" : ""} ${messages.length === 0 ? "is-empty" : ""}`}
      ref={conceptDropTarget}
      data-concept-drop={projectId}
      data-concept-drag-over={conceptDragOver || undefined}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes(CONCEPT_DRAG_MARKER) && !event.dataTransfer.types.includes(QUESTION_DROP_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current += 1;
        setConceptDragOver(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(CONCEPT_DRAG_MARKER) && !event.dataTransfer.types.includes(QUESTION_DROP_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes(CONCEPT_DRAG_MARKER) && !event.dataTransfer.types.includes(QUESTION_DROP_MIME)) return;
        event.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setConceptDragOver(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes(CONCEPT_DRAG_MARKER) && !event.dataTransfer.types.includes(QUESTION_DROP_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setConceptDragOver(false);
        if (event.dataTransfer.types.includes(QUESTION_DROP_MIME)) {
          receiveQuestion(event.dataTransfer.getData(QUESTION_DROP_MIME));
        } else receiveConcept(event.dataTransfer.getData(CONCEPT_DROP_MIME));
      }}
    >
      {!standalone && !embedded && (
        <header className="tutor-header">
          <div className="flex">
            <BookOpen size={18} aria-hidden="true" />
            <strong>学习 Tutor</strong>
          </div>
          <div className="flex">
            <button
              className="icon-button"
              aria-label="收起 Tutor"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </header>
      )}
      <div
        className="conversation"
        ref={conversation}
        aria-label="辅导对话"
        onScroll={saveViewport}
      >
        <div className="conversation-content" ref={conversationContent}>
        {branchContext && (
          <section className="tutor-branch-context" aria-label="对话来源">
            <div className="tutor-branch-origin">
              <button type="button" title={branchContext.title} onClick={branchContext.onReturn}>
                <CornerUpLeft size={13} aria-hidden="true" />来自：{branchContext.title}
              </button>
            </div>
            {branchContext.quote && (
              <details onToggle={(event) => setSourceExpanded(event.currentTarget.open)}>
                <summary onClick={preserveSourcePosition}>
                  <span className="branch-quote-preview">{branchContext.quote}</span>
                  <span className="branch-quote-expand">{sourceExpanded ? "收起来源摘录" : "展开来源摘录"}</span>
                </summary>
                <blockquote>{branchContext.quote}</blockquote>
              </details>
            )}
          </section>
        )}
        {messages.length === 0 ? (
          <div className="tutor-welcome">
            <h3>
              {paperContext ? "继续这个话题" : mode === "learning" ? "一起读懂这一页" : "开始对话"}
            </h3>
            <p>
              {paperContext
                ? `围绕「${paperContext.title}」提问。`
                : mode === "learning"
                  ? readingEnabled ? "选中原文追问，或直接输入问题。回答会结合当前阅读位置。" : `围绕${scopeLabel ? `「${scopeLabel}」` : "这份资料"}提问，随时回到原文核对。`
                  : goal || "围绕整本书提问、梳理思路，或检验你的理解。"}
            </p>
            <div className="suggestions">
              {(mode === "learning" || paperContext
                ? [
                    readingEnabled && mode === "learning" ? "解释当前页面的核心概念" : "梳理当前范围的核心概念",
                    "用一个小例子帮我理解",
                  ]
                : [
                    "这本书主要讲什么？",
                    "我应该先掌握哪些基础知识？",
                  ]
              ).map((q) => (
                <button key={q} onClick={() => void send(q)}>
                  <span>{q}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
            {!configured && (
              <div className="local-notice">
                当前可检索原文。<button onClick={onSettings}>连接模型</button>
                ，开启完整辅导。
              </div>
            )}
          </div>
        ) : (
          messages.map((m, messageIndex) => (
            <div
              key={m.id}
              data-message-id={m.id}
              tabIndex={-1}
              className={`message ${m.role} ${m.error ? "error" : ""} ${m.id === focusMessageId ? "is-source-focus" : ""}`}
            >
              {m.role === "assistant" && (
                <div className="message-byline">SideReader</div>
              )}
              {m.readingContext && (m.role === "user" || messages[messageIndex - 1]?.readingContext?.sourceId !== m.readingContext.sourceId || messages[messageIndex - 1]?.readingContext?.page !== m.readingContext.page) ? (
                <div className="message-reading-context">
                  <button
                    type="button"
                    onClick={() => onReadAnchor?.({ ...m.readingContext!, quote: m.readingContext!.quote || m.readingContext!.visibleText?.slice(0, 500) })}
                    disabled={!onReadAnchor}
                    title={`回到「${m.readingContext.title}」第 ${m.readingContext.page} 页的提问位置`}
                    aria-label={`回到提问时的原文：${m.readingContext.title}，第 ${m.readingContext.page} 页`}
                  >
                    <BookOpen size={12} aria-hidden="true" />
                    提问时 · 第 {m.readingContext.page} 页
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                  {m.role === "user" && m.readingContext.quote && (
                    <p title={m.readingContext.quote}>
                      “{m.readingContext.quote.slice(0, 100)}{m.readingContext.quote.length > 100 ? "…" : ""}”
                    </p>
                  )}
                </div>
              ) : !m.readingContext && mode === "learning" && m.role === "user" && (
                <div className="message-reading-context is-historical">
                  历史{m.role === "user" ? "提问" : "回答"} · 未记录提问位置
                </div>
              )}
              {m.role === "assistant" && !m.error && (
                <ResearchResult
                  message={m}
                  onRead={onReadAnchor}
                  onOpenProjectObject={onOpenProjectObject
                    ? (kind) => onOpenProjectObject(kind, m.id)
                    : undefined}
                  onApply={() =>
                    m.proposal && onApplyProposal?.(m.proposal, m.id)
                  }
                  onUndo={() => onUndoProposal?.(m.id)}
                />
              )}
              {m.role === "user" && Boolean(m.conceptReferences?.length) && (
                <div className="message-concept-references" aria-label="提问时引用的概念">
                  {m.conceptReferences!.map((concept) => (
                    <ReferenceSnapshot key={concept.id} concept={concept} onReadAnchor={onReadAnchor} onBeforeToggle={preserveSourcePosition} />
                  ))}
                </div>
              )}
              {m.role === "user" && Boolean(m.questionReferences?.length) && (
                <div className="message-concept-references" aria-label="提问时引用的习题">
                  {m.questionReferences!.map((question) => (
                    <ReferenceSnapshot key={question.id} question={question} onReadAnchor={onReadAnchor} onBeforeToggle={preserveSourcePosition} />
                  ))}
                </div>
              )}
              {m.role === "assistant" && !m.error ? (
                <Suspense
                  fallback={
                    <div className="message-text" role="status">
                      正在排版回答…
                    </div>
                  }
                >
                  <AnswerContent
                    content={m.content}
                    messageId={m.id}
                    projectId={projectId}
                    objectReferences={objectReferences}
                    evidence={m.evidence || []}
                    attempts={attempts}
                    drafts={drafts}
                    onDraft={onDraft}
                    onAttempt={onAttempt}
                    onOpen={(o) => onOpenObject?.(o, m.id, m.evidence || [])}
                    onCitation={cite}
                    onReferenceQuestion={referenceQuestion}
                  />
                  {m.conversationGraphs?.map((graph) => <ConversationGraphCard key={graph.id}
                    graph={referenceGraphs.find((current) => current.id === graph.id) || graph} projectId={projectId} workspaceNodeId={objectReferences?.[graph.id]}
                    onOpen={onOpenConversationGraph}
                    onReadAnchor={onReadAnchor}
                    onReferenceConcept={(conceptId) => receiveConcept(JSON.stringify({ version: 1, projectId, kind: "concept", conceptId }))} />)}
                  {Boolean(m.questionSets?.length) && <PracticeMessage
                    sets={m.questionSets!.map((saved) => questionSets.find((set) => set.id === saved.id) || saved)}
                    projectId={projectId} objectReferences={objectReferences}
                    onOpenObject={onOpenObject ? (object) => onOpenObject(object, m.id, m.evidence || []) : undefined}
                    onReferenceQuestion={referenceQuestion}
                    onReadAnchor={onReadAnchor}
                    evidence={m.evidence || []} attempts={attempts} drafts={drafts}
                    onAttempt={onAttempt} onDraft={onDraft} onCitation={cite} onOpen={onOpenQuestionSet}/>}
                </Suspense>
              ) : (
                <div
                  className="message-text"
                  role={m.error ? "alert" : undefined}
                >
                  {m.content}
                </div>
              )}
              {m.role === "assistant" && !m.error && (onBranch || onOpenObject) && (
                <div className="paper-message-actions">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => branchFromMessage(m)}
                  >
                    {answerSelection?.messageId === m.id ? "从选中内容追问" : "从这里追问"}
                  </button>

                </div>
              )}
              {m.evidence && m.evidence.length > 0 && (
                <details
                  className="answer-sources"
                  open={m.answerMode === "retrieval" ? true : undefined}
                >
                  <summary>
                    参考来源 <span>{m.evidence.length}</span>
                  </summary>
                  <div className="source-list">
                    {m.evidence.map((e, i) => (
                      <div className="source-entry" key={e.id}>
                        <EvidenceCitation evidence={e} onOpen={cite} label={`预览来源 ${i + 1}：${e.title}，第 ${e.page} 页`}>
                          <span className="source-number">{i + 1}</span>
                          <span>
                            {e.title}
                            <small>{e.path || `第 ${e.page} 页`}</small>
                          </span>
                          <ChevronRight size={14} aria-hidden="true" />
                        </EvidenceCitation>
                        <SourceEvidenceExcerpt text={e.text} sourceId={e.sourceId} page={e.page} />
                      </div>
                    ))}
                  </div>
                  {m.routes && (
                    <div className="retrieval-routes">
                      检索方式：{m.routes.join(" · ")}
                    </div>
                  )}
                </details>
              )}
              {m.error && (
                <button
                  className="retry-answer"
                  disabled={busy}
                  onClick={() => {
                    const previous = messages
                      .slice(0, messages.indexOf(m))
                      .reverse()
                      .find((item) => item.role === "user");
                    if (previous) void send(previous.content, previous.readingContext ?? null, previous.conceptReferences || [], previous.questionReferences || []);
                  }}
                >
                  重新尝试
                </button>
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="research-progress" role="status" aria-live="polite">
            <strong>{steps.at(-1)?.summary || "准备研究资料…"}</strong>
            <small>已记录 {steps.length} 条研究进展</small>
            <button
              className="button small"
              onClick={() => tutorSessions.stop(sessionKey)}
            >
              停止研究
            </button>
          </div>
        )}
        </div>
      </div>
      {answerSelection && (
        <button
          type="button"
          className="tutor-selection-action"
          style={{ top: answerSelection.top, left: answerSelection.left }}
          title={`从选中内容创建追问：${answerSelection.quote.slice(0, 80)}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const message = messages.find((item) => item.id === answerSelection.messageId);
            if (message) branchFromMessage(message, true);
          }}
        >
          <MessageSquarePlus size={14} aria-hidden="true" />选中追问
        </button>
      )}
      <div className="composer-wrap">
        <span className="concept-drop-hint" aria-hidden="true">松开后添加引用，继续输入问题</span>
        <span className="concept-reference-announcement" role="status" aria-live="polite">{conceptNotice}</span>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
        {selectedConcepts.length > 0 && (
          <div className="composer-concept-references" aria-label="本次提问引用的概念">
            {selectedConcepts.map((concept) => (
              <span className="composer-concept-chip" key={concept.id}>
                <Network size={13} aria-hidden="true" />
                <span title={`${concept.description}\n${concept.anchors?.map((anchor) => `${anchor.title} · 第 ${anchor.page} 页`).join("\n") || "未附原文位置"}`}>{concept.name}</span>
                <button type="button" aria-label={`移除引用：${concept.name}`} onClick={() => {
                  tutorSessions.removeConcept(sessionKey, concept.id);
                  setConceptWarning("");
                }}><X size={12} aria-hidden="true" /></button>
              </span>
            ))}
          </div>
        )}
        {selectedQuestions.length > 0 && (
          <div className="composer-concept-references" aria-label="本次提问引用的习题">
            {selectedQuestions.map((question) => (
              <span className="composer-concept-chip" key={question.id}>
                <FileQuestion size={13} aria-hidden="true" />
                <span title={question.question.prompt}>{question.title}</span>
                <button type="button" aria-label={`移除引用：${question.title}`} onClick={() => {
                  tutorSessions.removeQuestion(sessionKey, question.id);
                  setConceptWarning("");
                }}><X size={12} aria-hidden="true" /></button>
              </span>
            ))}
          </div>
        )}
        {conceptWarning && <div className="concept-reference-warning" role="status">{conceptWarning}</div>}
        {awayFromBottom && messages.length > 0 && (
          <button type="button" className="tutor-return-latest" onClick={returnToLatest}>
            <ArrowDown size={13} aria-hidden="true" />
            {hasNewMessages ? "有新消息 · 回到最新" : "回到最新"}
          </button>
        )}
        {activeReading?.quote && mode === "learning" && (
          <div className="selection-chip">
            <span>
              “{activeReading.quote.slice(0, 85)}
              {activeReading.quote.length > 85 ? "…" : ""}”
            </span>
            {!readingFixed && <button
              type="button"
              className="icon-button"
              aria-label="移除选中文本"
              onClick={() => {
                if (lockedReading && !readingFixed) tutorSessions.lockReading(
                  sessionKey,
                  { ...lockedReading.context, quote: undefined },
                  lockedReading.pageImage,
                );
                else clearSelection();
              }}
            >
              <X size={13} />
            </button>}
          </div>
        )}
          <textarea
            ref={composer}
            aria-label="向 Tutor 提问"
            title={`当前对话 · ${conversationTitle || paperContext?.title || "新对话"}`}
            placeholder={
              paperContext
                ? "继续追问这个话题…"
                : mode === "project"
                  ? "围绕这本书提问…"
                  : selectedConcepts.length || selectedQuestions.length ? "围绕引用内容提问…" : readingEnabled ? "问问这一页…" : "输入你的问题…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
          />
          <div className="composer-bottom">
            <div className="composer-destination">
            {mode === "learning" && activeReading && readingFixed ? (
              <button
                type="button"
                className="reading-context-toggle is-locked"
                disabled={!onReadAnchor}
                title={`回到分支依据：「${activeReading.title}」第 ${activeReading.page} 页`}
                onClick={() => onReadAnchor?.({
                  ...activeReading,
                  quote: activeReading.quote || activeReading.visibleText?.slice(0, 500),
                })}
              >
                <BookOpen size={12} aria-hidden="true" />
                分支依据 · 第 {activeReading.page} 页
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            ) : mode === "learning" && activeReading ? (
              <button
                type="button"
                className={`reading-context-toggle ${lockedReading ? "is-locked" : ""}`}
                aria-pressed={Boolean(lockedReading)}
                aria-label={lockedReading
                  ? `解除第 ${activeReading.page} 页的固定，跟随当前阅读位置`
                  : `固定第 ${activeReading.page} 页的提问上下文`}
                title={lockedReading
                  ? `已固定「${activeReading.title}」第 ${activeReading.page} 页，点击恢复跟随阅读`
                  : "跟随阅读位置。点击固定这一页及选段，翻页后仍围绕这里提问。"}
                onClick={() => tutorSessions.lockReading(
                  sessionKey,
                  lockedReading ? null : liveReading ?? null,
                  lockedReading ? "" : pageImage,
                )}
              >
                {lockedReading ? <Pin size={12} /> : <BookOpen size={12} />}
                {lockedReading ? "固定" : "跟随"}第 {activeReading.page} 页
                {lockedReading && <PinOff size={11} aria-hidden="true" />}
              </button>
            ) : (
              <span className="composer-scope" title={scopeLabel}>
                <BookOpen size={12} aria-hidden="true" />
                <span>{scopeLabel || `${sources.length} 个知识来源`}</span>
              </span>
            )}
            </div>
            <ActionMenu
              label={configured ? "对话设置" : "模型未连接，打开对话设置"}
              className="composer-settings"
              placement="top"
              trigger={<><Settings2 size={14} aria-hidden="true" />{!configured ? <span>连接模型</span> : mode === "project" && researchMode === "deep" ? <span>深度研究</span> : null}</>}
            >
              {!configured && <span className="action-menu-label">模型未连接 · 当前可检索原文</span>}
              {mode === "project" && <div className="conversation-setting-field" data-menu-keep-open>
                <label htmlFor={`${preferenceId}-research`}>研究方式</label>
                <select id={`${preferenceId}-research`} disabled={busy} value={researchMode}
                  onChange={(event) => setResearchMode(event.target.value as "auto" | "deep")}>
                  <option value="auto">自动</option>
                  <option value="deep">深度研究</option>
                </select>
                <small>{researchMode === "deep" ? "每次提问都会深入核对项目资料。" : "根据问题按需检索与研究。"}</small>
              </div>}
              {mode === "learning" && activePageImage && configured && <div className="conversation-setting-field" data-menu-keep-open>
                <label htmlFor={`${preferenceId}-image`}>页面图像</label>
                <select id={`${preferenceId}-image`} value={imageMode} onChange={(event) => setImageMode(event.target.value as "auto" | "on" | "off")}>
                  <option value="auto">自动</option>
                  <option value="on">始终附带</option>
                  <option value="off">关闭</option>
                </select>
                <small>附带时，本页图像会发送给已配置的模型。</small>
              </div>}
              {attempts.length > 0 && <p className="conversation-setting-note">
                已带入 {Math.min(12, attempts.length)} 条学习记录，用于衔接最近的作答和反馈。
              </p>}
              <button type="button" onClick={onSettings}>
                <Settings2 size={15} aria-hidden="true" />
                {configured ? "配置模型" : "连接模型"}
              </button>
              <hr className="action-menu-divider" />
              <button type="button" disabled={busy || !messages.length} onClick={restartConversation}>
                <Trash2 size={15} aria-hidden="true" />清空当前对话
              </button>
            </ActionMenu>
            <button
              className="send"
              aria-label="发送问题"
              disabled={!input.trim() || busy}
            >
              <ArrowUp size={17} />
            </button>
          </div>
        </form>
        <div className="composer-hint">Enter 发送 · Shift + Enter 换行</div>
      </div>
    </aside>
  );
}
