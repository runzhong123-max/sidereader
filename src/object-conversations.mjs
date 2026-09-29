import { conversationOwner, conversationRoot } from "./conversation-model.mjs";
import { createRelationIndex, chapterRange, walkParents } from "./domain/relations.mjs";
import { attachPaperNode, nodeTitle, normalizePaperTree } from "./paper-tree-state.mjs";
import { surfaceContent } from "./domain/learning-surface.mjs";

const chatFor = (project, node) => node?.kind === "chat"
  ? project.chats?.find((chat) => chat.id === (node.objectId || node.id)) : undefined;

// Reading a scope does not materialize its conversation. Older projects can be
// projected through normalization without writing that projection back.
const prepared = (project) => project.paperTree?.tutorId ? project : normalizePaperTree(project);

function ownerFor(project, scopeId) {
  const relations = createRelationIndex(project), node = relations.nodes.get(scopeId);
  return chapterRange(relations, node) ? node : conversationOwner(project, scopeId) || relations.tutor;
}

function belongsToObject(project, node) {
  const relations = createRelationIndex(project);
  const root = conversationRoot(project, node.id);
  return [...walkParents(relations.nodes, node.id)].some((parent) => chatFor(project, parent)?.context?.objectNodeId) ||
    Boolean(root && (chatFor(project, root)?.context?.objectNodeId ||
      ["graph", "questions", "paper"].includes(relations.nodes.get(root.parentId)?.kind)));
}

const savedTime = (value) => {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
};

/** Same-scope references stay in the active paper, then resume the latest main chat. */
export function conversationForScope(project, scopeId, preferredId) {
  const next = prepared(project), owner = ownerFor(next, scopeId);
  if (!owner) return;
  const nodes = next.paperTree.nodes;
  const accepts = (node) => node?.kind === "chat" && chatFor(next, node) && !belongsToObject(next, node) &&
    ownerFor(next, node.id)?.id === owner.id;
  const preferred = nodes.find((node) => node.id === preferredId);
  if (accepts(preferred)) return preferred;
  const eligible = nodes.filter(accepts);
  const roots = new Map(eligible
    .filter((node) => conversationRoot(next, node.id)?.id === node.id)
    .map((node) => [node.id, { node, interacted: false, lastInteraction: 0 }]));
  for (const node of eligible) {
    const chat = chatFor(next, node);
    if (!chat.messages?.some((message) => message.role === "user")) continue;
    const root = roots.get(conversationRoot(next, node.id)?.id);
    if (!root) continue;
    root.interacted = true;
    // Older saved chats have no interaction timestamp. Their creation time is
    // a stable fallback; branches contribute activity to their main conversation.
    root.lastInteraction = Math.max(root.lastInteraction,
      savedTime(chat.lastInteractionAt) || savedTime(node.created));
  }
  const used = [...roots.values()].filter((entry) => entry.interacted);
  // Keep the project Tutor as the default until there is a conversation to resume.
  if (!used.length && roots.has(owner.id)) return owner;
  return (used.length ? used : [...roots.values()]).sort((a, b) =>
    b.lastInteraction - a.lastInteraction ||
    savedTime(b.node.created) - savedTime(a.node.created) ||
    Number(b.node.id === next.paperTree.tutorId) - Number(a.node.id === next.paperTree.tutorId) ||
    a.node.id.localeCompare(b.node.id),
  )[0]?.node;
}

/** A virtual empty chapter conversation is safe to render before the first ask. */
export function scopeConversation(project, scopeId, preferredId) {
  const next = prepared(project);
  const existing = conversationForScope(next, scopeId, preferredId);
  if (existing) return { node: existing, chat: chatFor(next, existing) };
  const owner = ownerFor(next, scopeId);
  const id = `scope-chat:${encodeURIComponent(owner.id)}`;
  const title = owner.role === "chapter" ? `关于${nodeTitle(next, owner)}` : "项目 Tutor";
  const context = {
    parentId: owner.id, scopeNodeId: owner.id,
    ...(owner.sourceId ? { sourceId: owner.sourceId } : {}),
  };
  return {
    node: { id, kind: "chat", parentId: owner.id, conversationRoot: true, origin: "manual" },
    chat: { id, title, messages: [], context },
  };
}

/** Called on the first question, never merely because a PDF chapter was opened. */
export function ensureScopeConversation(project, scopeId, preferredId) {
  const next = prepared(project), selected = scopeConversation(next, scopeId, preferredId);
  if (chatFor(next, selected.node)) return { project: next, nodeId: selected.node.id };
  return {
    project: attachPaperNode({ ...next, chats: [...next.chats, selected.chat] }, selected.node),
    nodeId: selected.node.id,
  };
}

function questionText(question) {
  return [question.prompt, ...(question.options || []).map((option, index) => `${index + 1}. ${option}`)].filter(Boolean).join("\n");
}

/** Public context contains prompts/options, never a hidden answer or explanation. */
export function objectConversationContext(project, nodeId) {
  const node = project.paperTree?.nodes.find((item) => item.id === nodeId);
  if (!node || !["graph", "questions", "paper"].includes(node.kind)) return;
  const owner = ownerFor(project, nodeId);
  const title = nodeTitle(project, node);
  const content = surfaceContent(project, node);
  let object, evidence, sourceMessageId = node.sourceMessageId;
  if (node.kind === "paper") {
    const { paper, object: resolved } = content;
    if (!paper || !resolved) return;
    object = resolved.kind === "question" ? { ...resolved, content: "" } : resolved;
    evidence = paper.evidence;
    sourceMessageId ||= paper.sourceMessageId;
  } else if (node.kind === "graph") {
    const { concepts } = content;
    const names = new Map(concepts.map((concept) => [concept.id, concept.name]));
    object = {
      id: `context:${node.id}`, kind: "concept", title,
      content: concepts.map((concept) => {
        const links = (concept.links || []).map((id) => names.get(id)).filter(Boolean);
        return `${concept.name}：${concept.description || ""}${links.length ? `\n关联：${links.join("、")}` : ""}`;
      }).join("\n\n"),
    };
  } else {
    const { sets } = content;
    object = {
      id: `context:${node.id}`, kind: "note", title,
      content: sets.map((set) => [set.title, ...set.questions.map((question, index) => `${index + 1}. ${questionText(question)}`)].join("\n\n")).join("\n\n"),
    };
  }
  return {
    parentId: node.id, objectNodeId: node.id, scopeNodeId: owner?.id,
    ...(owner?.sourceId || node.anchor?.sourceId ? { sourceId: owner?.sourceId || node.anchor.sourceId } : {}),
    ...(node.anchor ? { reading: node.anchor } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
    quote: object.kind === "question" && object.question ? questionText(object.question) : object.content,
    object,
    ...(evidence?.length ? { evidence } : {}),
  };
}

/** One object-owned conversation, materialized only when the user asks about it. */
export function ensureObjectConversation(project, nodeId) {
  const next = prepared(project), context = objectConversationContext(next, nodeId);
  if (!context) return { project, nodeId: undefined };
  const nodes = next.paperTree.nodes;
  const existing = nodes.find((node) => chatFor(next, node)?.context?.objectNodeId === nodeId) ||
    nodes.find((node) => node.kind === "chat" && node.parentId === nodeId && chatFor(next, node));
  if (existing) {
    const chat = chatFor(next, existing);
    // The excerpt records where the conversation started; the object and its
    // scope remain live identities when reopened after an edit or move.
    const updatedContext = { ...chat.context, ...context, quote: chat.context?.quote ?? context.quote };
    const sameContext = JSON.stringify(updatedContext) === JSON.stringify(chat.context);
    if (sameContext && existing.conversationRoot === true) return { project: next, nodeId: existing.id };
    return {
      project: {
        ...next,
        chats: next.chats.map((item) => item === chat ? { ...chat, context: updatedContext } : item),
        paperTree: { ...next.paperTree, nodes: nodes.map((node) => node === existing ? { ...node, conversationRoot: true } : node) },
      },
      nodeId: existing.id,
    };
  }
  const base = `object-chat:${encodeURIComponent(nodeId)}`;
  let id = base, suffix = 1;
  while (nodes.some((node) => node.id === id) || next.chats.some((chat) => chat.id === id)) id = `${base}:${++suffix}`;
  const title = `关于${nodeTitle(next, nodes.find((node) => node.id === nodeId))}`;
  const node = { id, kind: "chat", parentId: nodeId, conversationRoot: true, origin: "object" };
  return {
    project: attachPaperNode({ ...next, chats: [...next.chats, { id, title, messages: [], context }] }, node),
    nodeId: id,
  };
}
