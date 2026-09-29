import { conversationOwner } from "./conversation-model.mjs";
import { nodeTitle } from "./paper-tree-state.mjs";

/** Describe stored provenance, without treating an unlabelled legacy file as authored or generated. */
export function questionOriginLabel(set) {
  if (set?.origin === "textbook") return "教材习题";
  if (set?.origin === "manual") return "自编习题";
  if (set?.origin === "generated") return set.presentation === "inline" ? "随堂检测" : "生成练习";
  return "习题";
}

export function objectScopeLabel(project, nodeId) {
  const owner = conversationOwner(project, nodeId);
  return owner?.role === "chapter" ? nodeTitle(project, owner) : project.name || "本项目";
}

/** A graph's conversation source is valid only while that exact message remains available. */
export function graphProvenance(project, node) {
  const local = Array.isArray(node?.graphConcepts);
  const owner = conversationOwner(project, node?.id);
  const origin = project.paperTree?.nodes.find((item) => item.id === node?.parentId && item.kind === "chat");
  const chat = origin && project.chats?.find((item) => item.id === (origin.objectId || origin.id));
  const hasOrigin = Boolean(local && node?.sourceMessageId && chat?.messages.some((message) => message.id === node.sourceMessageId));
  return {
    label: local ? "本次对话图谱" : owner?.role === "chapter" ? "本章知识图谱" : "项目知识图谱",
    scope: objectScopeLabel(project, node?.id),
    origin: hasOrigin ? origin : undefined,
    originTitle: hasOrigin ? nodeTitle(project, origin) : undefined,
  };
}
