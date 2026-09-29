import type { Chat, PaperNode, Project } from "./types";

export function conversationForScope(project: Project, scopeId: string, preferredId?: string): PaperNode | undefined;
export function scopeConversation(project: Project, scopeId: string, preferredId?: string): { node: PaperNode; chat: Chat };
export function ensureScopeConversation(project: Project, scopeId: string, preferredId?: string): { project: Project; nodeId: string };
export function objectConversationContext(project: Project, nodeId: string): Chat["context"] | undefined;
export function ensureObjectConversation(project: Project, nodeId: string): { project: Project; nodeId: string | undefined };
