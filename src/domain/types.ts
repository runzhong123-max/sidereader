/** Persistent learning content and its addressable workspace references.
 * Field names remain compatible with existing local projects; presentation state is separate.
 */
import type { LearningObjectKind, LearningSurfaceKind } from "./objects.mjs";
export type { LearningObjectKind, LearningSurfaceKind } from "./objects.mjs";

import type { ProjectUpdateReceipt } from "../project-updates.mjs";
import type { StageRemoval } from "../stage-state.mjs";
import type { QuestionDraft } from "../question-state.mjs";

export type View =
  "overview" | "library" | "reader" | "graph" | "path" | "questions";
export interface Chunk {
  id: string;
  sourceId: string;
  title: string;
  page: number;
  text: string;
  path?: string;
}
export interface Source {
  id: string;
  title: string;
  author: string;
  kind: "pdf" | "github" | "note";
  description: string;
  pages: string[];
  chunks: Chunk[];
  added: string;
  progress: number;
  color: string;
  url?: string;
  demo?: boolean;
  outline?: SourceSection[];
}
export interface SourceSection {
  id: string;
  title: string;
  page: number;
  endPage: number;
  level: number;
  parentId?: string;
  kind: "chapter" | "section" | "document" | "pages";
}
export interface Concept {
  layout?: { x: number; y: number };
  anchors?: ReadingAnchor[];
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  group: number;
  links: string[];
}
/** An agent-generated map of this conversation, separate from the project graph. */
export interface ConversationGraph {
  id: string;
  title: string;
  concepts: Concept[];
}
export interface Stage {
  anchors?: ReadingAnchor[];
  deliverable?: string;
  check?: string;
  prerequisites?: string[];
  id: string;
  title: string;
  description: string;
  done: boolean;
  tag: string;
}
export interface Question {
  id: string;
  type: "choice" | "boolean" | "short";
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  hint?: string;
  answerStatus?: "provided" | "missing";
  sourceQuestionNumber?: string;
  anchors?: ReadingAnchor[];
}
export interface QuestionSet {
  id: string;
  title: string;
  description: string;
  questions: Question[];
  lastScore?: number;
  origin?: "generated" | "textbook" | "manual";
  presentation?: "inline" | "collection";
  scopeNodeId?: string;
  sourceMessageId?: string;
  anchors?: ReadingAnchor[];
}
export interface Workspace {
  version: number;
  name: string;
  sources: Source[];
  concepts: Concept[];
  stages: Stage[];
  sets: QuestionSet[];
  activeSource: string;
  page: number;
  goal: string;
}
export interface Evidence extends Chunk {
  score?: number;
}
export interface Message {
  conversationGraphs?: ConversationGraph[];
  questionReferences?: import("../question-references.mjs").QuestionReference[];
  conceptReferences?: Array<Pick<Concept, "id" | "name" | "description" | "anchors">>;
  questionSets?: QuestionSet[];
  readingContext?: ReadingContext;
  research?: ResearchReport;
  proposal?: ProjectProposal;
  proposalApplied?: boolean;
  proposalUndo?: ProjectUpdateReceipt;
  proposalReferences?: { concepts: string[]; stages: string[] };
  proposalReverted?: { retained: number };
  id: string;
  role: "user" | "assistant";
  content: string;
  evidence?: Evidence[];
  routes?: string[];
  error?: boolean;
  answerMode?: "model" | "retrieval";
}
export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  /** Time of the latest user question; absent in older saved conversations. */
  lastInteractionAt?: string;
  context?: {
    parentId: string;
    sourceId?: string;
    scopeNodeId?: string;
    /** Lazily created conversation belonging to one learning object. */
    objectNodeId?: string;
    sourceMessageId?: string;
    quote?: string;
    reading?: ReadingContext;
    object?: LearningObject;
    evidence?: Evidence[];
  };
}
/** An address/reference, not a copy of the underlying file or object. */
export interface WorkspaceTab {
  id: string;
  kind: "chat" | "book" | LearningSurfaceKind;
  sourceId?: string;
  objectId?: string;
}
export interface Project extends Workspace {
  paperTree?: { version: 1 | 2; rootId: string; tutorId?: string; nodes: PaperNode[] };
  questionDrafts?: Record<string, QuestionDraft>;
  practicePositions?: Record<string, string>;
  stageRemoval?: StageRemoval;
  bookmarks?: Bookmark[];
  papers?: Paper[];
  attempts?: LearningAttempt[];
  id: string;
  chats: Chat[];
  tabs: WorkspaceTab[];
  activeTab: string;
}

export interface GraphCoverage {
  sampledPages: number;
  totalPages: number;
  sampledChunks: number;
  totalChunks: number;
  truncated: boolean;
}

/** Legacy storage relation. Use domain projections for ownership/navigation. */
export interface PaperNode extends WorkspaceTab {
  /** Local graph content; never merged into project/automatic chapter concepts. */
  graphConcepts?: Concept[];
  /** Explicit independent conversation versus a branch inside another conversation. */
  conversationRoot?: boolean;
  autoGraph?: {
    fingerprint: string;
    status: "generating" | "ready" | "error";
    error?: string;
    startedAt?: string;
    completedAt?: string;
    coverage?: GraphCoverage;
  };
  parentId: string | null;
  role?: "source" | "chapter" | "stage" | "bookmark" | "scope-graph" | "history";
  sectionKind?: SourceSection["kind"];
  endPage?: number;
  bookmarkId?: string;
  stageId?: string;
  progress?: number;
  title?: string;
  origin?: "root" | "manual" | "import" | "selection" | "object" | "tool" | "legacy";
  sourceMessageId?: string;
  quote?: string;
  anchor?: ReadingContext;
  conceptIds?: string[];
  stageIds?: string[];
  created?: string;
}

export interface ReadingAnchor {
  sourceId: string;
  page: number;
  title: string;
  quote?: string;
}
// A question keeps its original reading context even after the reader moves.
// Page images are deliberately excluded from persisted messages.
export interface ReadingContext extends ReadingAnchor {
  visibleText?: string;
}
export interface Bookmark extends ReadingAnchor {
  id: string;
  created: string;
}
export interface ProjectProposal {
  concepts: Concept[];
  stages: Stage[];
  warnings: string[];
}
export interface ResearchStep {
  tool: string;
  summary: string;
  count?: number;
}
export interface ResearchReport {
  mode: "deep" | "qa";
  rounds: number;
  stopReason: string;
  elapsedMs: number;
  coverage: {
    indexedPages: number;
    sampledPages: number;
    totalSections: number;
    sampledSections: number;
    missingSections: string[];
    note: string;
  };
  gaps: string[];
  trace: ResearchStep[];
  catalogCacheHit: boolean;
  metrics: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    usageReported: boolean;
  };
}
export interface ProjectStore {
  version: 2;
  projects: Project[];
  activeProjectId: string;
}

export interface LearningObject {
  id: string;
  kind: LearningObjectKind;
  title: string;
  content: string;
  language?: string;
  question?: Question;
  plot?: {
    type: "line" | "scatter" | "bar";
    xLabel: string;
    yLabel: string;
    series: { name: string; points: [number, number][] }[];
  };
  steps?: { title: string; content: string }[];
}
export interface LearningAttempt {
  questionRevision?: string;
  answerValue?: string;
  id: string;
  objectId: string;
  prompt: string;
  answer: string;
  result:
    | "correct"
    | "incorrect"
    | "skipped"
    | "needs-review"
    | "self-correct"
    | "self-incorrect"
    | "hint-viewed";
  assisted: boolean;
  feedback: string;
  at: string;
}
/** Saved object view with provenance; opening it does not create a conversation. */
export interface Paper {
  id: string;
  parentId: string;
  parentTitle: string;
  parentTab: WorkspaceTab;
  title: string;
  sourceMessageId?: string;
  object: LearningObject;
  evidence: Evidence[];
  created: string;
}

/** Semantic names for new code; legacy names stay available for saved-project compatibility. */
export type WorkspaceTarget = WorkspaceTab;
export type WorkspaceNode = PaperNode;
export type ObjectView = Paper;
export type PracticeFile = QuestionSet;
