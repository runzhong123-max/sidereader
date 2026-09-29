import type { PaperNode, Project, ReadingAnchor } from "./types";

/** The actual independent conversation containing a chat or its generated paper. */
export function conversationRoot(project: Project, nodeId: string): PaperNode | undefined;
/** Fixed conversation scope, projected onto a valid chapter or project tutor. */
export function conversationOwner(project: Project, nodeId: string, reading?: ReadingAnchor): PaperNode | undefined;
/** Pure-chat tree for one independent conversation, with its root parent set to null. */
export function conversationNodes(project: Project, rootId: string): PaperNode[];
export interface ConversationSummary {
  rootId: string;
  lastQuestion: string;
  lastInteractionAt?: string;
  sortTime: number;
  hasInteraction: boolean;
  searchText: string;
}
/** Recent question and searchable question history, including internal branches. */
export function conversationSummary(project: Project, nodeId: string): ConversationSummary | undefined;
/** Hide a question preview when it only repeats the title or its truncated prefix. */
export function conversationQuestionPreview(title: string, question?: string): string;
export interface ConversationSearchMatch { nodeId: string; messageId?: string; text: string; }
/** Exact question or branch title match without promoting branches into project navigation. */
export function conversationSearchMatch(project: Project, rootId: string, query: string): ConversationSearchMatch | undefined;
/** Valid saved paper in this main conversation, or the main conversation itself. */
export function conversationResumeTarget(project: Project, rootId: string, lastVisitedId?: string): PaperNode | undefined;
/** Sidebar source PDFs, nested chapters and independent conversations; branches and objects stay outside. */
export function projectNavigationNodes(project: Project): PaperNode[];
/** Exact PDF/chapter identity, independent conversation root for any child, or an object's owning location. */
export function projectNavigationId(project: Project, nodeId: string): string;
/** Nearest actual PDF/chapter/chat parent for a new paper; fixed chapter scope is resolved independently. */
export function newConversationParent(project: Project, nodeId: string, reading?: ReadingAnchor): PaperNode | undefined;
