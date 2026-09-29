import type { Message, Project } from "./types";
export function conversationGraphNodeId(parentId: string, graphId: string): string;
export function captureConversationGraphs(project: Project, parentId: string, message: Message): Project;
export function restoreConversationGraphs(project: Project): Project;
