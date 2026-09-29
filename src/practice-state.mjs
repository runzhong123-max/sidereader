import { conversationOwner } from "./conversation-model.mjs";
import { normalizePaperTree } from "./paper-tree-state.mjs";

function validSet(set) {
  return set && typeof set.id === "string" && set.id.trim() &&
    typeof set.title === "string" && set.title.trim() &&
    Array.isArray(set.questions) && set.questions.length > 0 &&
    new Set(set.questions.map((question) => question?.id)).size === set.questions.length &&
    set.questions.every((question) => question && typeof question.id === "string" && question.id.trim() &&
      ["choice", "boolean", "short"].includes(question.type) &&
      typeof question.prompt === "string" && question.prompt.trim() &&
      Array.isArray(question.options) && question.options.every((option) => typeof option === "string") &&
      typeof question.answer === "string" && (question.answer.trim() || question.answerStatus === "missing"));
}

/** Persist a completed tool result once, without navigating or revising user work. */
export function persistMessagePractice(project, parentId, message) {
  if (message?.role !== "assistant" || message.error || !message.id || !Array.isArray(message.questionSets)) return project;
  const existingIds = new Set((project.sets || []).map((set) => set.id));
  const additions = [];
  for (const set of message.questionSets) {
    if (!validSet(set) || existingIds.has(set.id)) continue;
    existingIds.add(set.id);
    additions.push(set);
  }
  if (!additions.length) return project;

  const base = project.paperTree ? project : normalizePaperTree(project);
  const tutorId = base.paperTree.tutorId;
  const origin = base.paperTree.nodes.find((node) => node.id === parentId);
  const originId = origin?.id || tutorId;
  const scopeNodeId = conversationOwner(base, originId)?.id || tutorId;
  const saved = additions.map((set) => ({ ...set, scopeNodeId, sourceMessageId: message.id }));
  const nodes = [...base.paperTree.nodes];
  for (const set of saved) {
    const id = `questions:${set.id}`;
    if (nodes.some((node) => node.id === id || node.kind === "questions" && node.objectId === set.id)) continue;
    nodes.push({
      id, kind: "questions", objectId: set.id, parentId: originId,
      origin: "tool", sourceMessageId: message.id,
      ...(message.readingContext ? { anchor: message.readingContext } : {}),
    });
  }
  return {
    ...project,
    ...(base.chats !== project.chats ? { chats: base.chats } : {}),
    sets: [...(project.sets || []), ...saved],
    paperTree: { ...base.paperTree, nodes },
  };
}
