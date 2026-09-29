import { conversationOwner } from "./conversation-model.mjs";

/** Graphs and conversations share the same fixed project/chapter ownership. */
export function knowledgeGraphOwner(project, nodeId) {
  return conversationOwner(project, nodeId);
}
