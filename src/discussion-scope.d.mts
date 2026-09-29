import type { Project, Source, PaperNode, Chat } from "./types";
export interface DiscussionScope { scopeNodeId?: string; sourceId?: string }
export function nodeConversation(project: Project, node?: PaperNode): Chat | undefined;
export function discussionScope(project: Project, parentId: string): DiscussionScope;
export function discussionSources(project: Project, scope?: DiscussionScope): Source[];
