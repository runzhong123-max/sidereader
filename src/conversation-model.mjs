import { createRelationIndex, chapterRange, chapterForReading, walkParents, traceChain } from "./domain/relations.mjs";

/**
 * Project navigation contains PDF outlines and independent conversations.
 * Branch papers are projected only inside their conversation. Neither projection
 * rewrites saved ancestry or the fixed context of a paper.
 */
function model(project) {
  return createRelationIndex(project);
}

function validChapter(data, node) {
  return chapterRange(data, node) ? node : undefined;
}

function chatContext(data, node) {
  return node?.kind === "chat"
    ? data.chats.get(node.objectId || node.id)?.context
    : undefined;
}

function questionSet(data, node) {
  return node?.kind === "questions" && node.objectId
    ? data.sets.get(node.objectId)
    : undefined;
}

// Generated objects are transparent to conversation ancestry, including old
// graph snapshots. Project-wide collections and PDF locations are boundaries.
function enclosingChat(nodes, node) {
  for (const current of walkParents(nodes, node?.id)) {
    if ((current.id === "questions" && current.kind === "questions") ||
      (current.id === "graph" && current.kind === "graph") ||
      (current.id === "path" && current.kind === "path")) return;
    if (current.kind === "chat") return current;
    if (!["paper", "questions", "graph", "path"].includes(current.kind)) return;
  }
}

function ownerFor(data, nodeId, reading) {
  const { nodes, tutor } = data;
  const initial = nodes.get(nodeId);
  if (initial?.id === tutor?.id) return tutor;
  const savedAnchor = initial?.kind === "chat" || initial?.role === "bookmark" ? initial.anchor : undefined;
  for (const node of walkParents(nodes, nodeId)) {
    const set = questionSet(data, node);
    if (set?.scopeNodeId) return validChapter(data, nodes.get(set.scopeNodeId)) || tutor;
    const context = chatContext(data, node);
    if (context?.scopeNodeId) return validChapter(data, nodes.get(context.scopeNodeId)) || tutor;
    if (context?.reading) return chapterForReading(data, context.reading) || tutor;
    if (context?.sourceId) return tutor;
    if (node.kind === "chat" && node.anchor) return chapterForReading(data, node.anchor) || tutor;
    if (node.role === "history" && !node.graphConcepts) return tutor;
    if (node.role === "chapter") return validChapter(data, node) || tutor;
    if (node.kind === "graph" && !node.graphConcepts) return node.role === "scope-graph" ? validChapter(data, nodes.get(node.parentId)) || tutor : tutor;
    if (node.kind === "path" || node.role === "stage") return tutor;
    if (node.kind === "book") {
      const anchor = (initial?.kind === "book" && reading?.sourceId === node.sourceId ? reading : undefined) || savedAnchor;
      return chapterForReading(data, anchor) || tutor;
    }
  }
  return tutor;
}

function isIndependent(data, node, parent, tutor) {
  if (node.conversationRoot !== undefined) return node.conversationRoot;
  if (parent?.id !== tutor?.id) return false;
  const context = chatContext(data, node);
  // Old manual project conversations had the tutor as a storage parent. Only
  // explicit answer/selection provenance makes such an edge a true branch.
  return !(node.sourceMessageId || node.quote || node.origin === "selection" || context?.sourceMessageId || context?.quote);
}

function rootFor(data, nodeId) {
  const chain = traceChain(enclosingChat(data.nodes, data.nodes.get(nodeId)), (current) => {
    if (current.id === data.tutor?.id) return;
    const parent = enclosingChat(data.nodes, data.nodes.get(current.parentId));
    return parent && !isIndependent(data, current, parent, data.tutor) ? parent : undefined;
  });
  return chain.cycleStart >= 0
    ? chain.nodes.slice(chain.cycleStart).sort((a, b) => a.id.localeCompare(b.id))[0]
    : chain.nodes.at(-1);
}

/** The actual independent conversation containing a chat or its generated paper. */
export function conversationRoot(project, nodeId) {
  return rootFor(model(project), nodeId);
}

/** Fixed context wins over displayed ancestry; only chapters and project own chats. */
export function conversationOwner(project, nodeId, reading) {
  return ownerFor(model(project), nodeId, reading);
}

/** A pure-chat tree for one independent conversation, without generated fragments. */
export function conversationNodes(project, rootId) {
  const data = model(project);
  const root = rootFor(data, rootId);
  if (!root) return [];
  const members = [...data.nodes.values()].filter((node) => node.kind === "chat" && node.role !== "history" && rootFor(data, node.id)?.id === root.id);
  const memberIds = new Set(members.map((node) => node.id));
  return members.map((node) => {
    if (node.id === root.id) return { ...node, parentId: null };
    const parent = enclosingChat(data.nodes, data.nodes.get(node.parentId));
    // Breaking a corrupt cycle at its canonical root also keeps every tail
    // reachable. A dangling intermediary falls back to this conversation only.
    return { ...node, parentId: parent && parent.id !== node.id && memberIds.has(parent.id) ? parent.id : root.id };
  });
}

const timestamp = (value) => {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
};

/** Navigation reads question history across a main conversation without exposing its branches as roots. */
export function conversationSummary(project, nodeId) {
  const data = model(project), root = rootFor(data, nodeId);
  if (!root) return;
  const members = [...data.nodes.values()].filter((node) => node.kind === "chat" && node.role !== "history" && rootFor(data, node.id)?.id === root.id);
  const searchable = [];
  const interacted = [];
  for (const node of members) {
    const chat = data.chats.get(node.objectId || node.id);
    if (!chat) continue;
    const questions = (chat.messages || []).filter((message) => message.role === "user" && message.content?.trim());
    searchable.push(node.title || "", chat.title || "", ...questions.map((message) => message.content));
    const question = questions.at(-1);
    if (question) interacted.push({ node, chat, question, time: timestamp(chat.lastInteractionAt) || timestamp(node.created) });
  }
  interacted.sort((a, b) => b.time - a.time || a.node.id.localeCompare(b.node.id));
  const latest = interacted[0];
  return {
    rootId: root.id,
    lastQuestion: latest?.question.content.replace(/\s+/g, " ").trim() || "",
    lastInteractionAt: timestamp(latest?.chat.lastInteractionAt) ? latest.chat.lastInteractionAt : undefined,
    sortTime: latest?.time || timestamp(root.created),
    hasInteraction: Boolean(latest),
    searchText: searchable.join("\n"),
  };
}

/** An auto-title often repeats the first question; do not spend a second row on that same prefix. */
export function conversationQuestionPreview(title, question) {
  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();
  const label = clean(title).replace(/(?:\.{3}|…)+$/, "").trim();
  const preview = clean(question);
  return !preview || (label && (preview.startsWith(label) || label.startsWith(preview))) ? "" : preview;
}

/** Search stays grouped under its main conversation but retains the exact paper and question to open. */
export function conversationSearchMatch(project, rootId, query) {
  const needle = (query || "").trim().toLocaleLowerCase();
  if (!needle) return;
  const data = model(project), root = rootFor(data, rootId);
  if (!root || root.id !== rootId) return;
  const matches = [];
  for (const node of data.nodes.values()) {
    if (node.kind !== "chat" || node.role === "history" || rootFor(data, node.id)?.id !== root.id) continue;
    const chat = data.chats.get(node.objectId || node.id);
    if (!chat) continue;
    const message = (chat.messages || []).findLast((item) => item.role === "user" && item.content?.toLocaleLowerCase().includes(needle));
    const title = [node.title, chat.title].find((text) => text?.toLocaleLowerCase().includes(needle));
    if (message || title) matches.push({ nodeId: node.id, messageId: message?.id, text: message?.content || title,
      time: timestamp(chat.lastInteractionAt) || timestamp(node.created), question: Boolean(message) });
  }
  matches.sort((a, b) => Number(b.question) - Number(a.question) || b.time - a.time || a.nodeId.localeCompare(b.nodeId));
  const match = matches[0];
  return match ? { nodeId: match.nodeId, messageId: match.messageId, text: match.text } : undefined;
}

/** Resume a remembered paper only inside its original main conversation; never rewrite its content or context. */
export function conversationResumeTarget(project, rootId, lastVisitedId) {
  const data = model(project), root = rootFor(data, rootId);
  if (!root || root.id !== rootId) return;
  const available = (node) => node?.kind === "chat" && data.chats.has(node.objectId || node.id) && node.role !== "history";
  const last = data.nodes.get(lastVisitedId);
  if (available(last) && rootFor(data, last.id)?.id === root.id) return last;
  return available(root) ? root : undefined;
}

function isSourcePaper(data, node) {
  return node?.kind === "book" &&
    (node.role === "source" || (!node.role && node.id === `book:${node.sourceId}`)) && data.sources.has(node.sourceId);
}

function sourceRoot(data, nodeId) {
  const sourceNodes = [...data.nodes.values()].filter((node) => isSourcePaper(data, node));
  const source = (id) => sourceNodes.find((node) => node.sourceId === id);
  for (const node of walkParents(data.nodes, nodeId)) {
    const context = chatContext(data, node);
    if (context) {
      const scoped = validChapter(data, data.nodes.get(context.scopeNodeId));
      const known = source(scoped?.sourceId || context.reading?.sourceId || context.sourceId);
      if (known) return known;
      if (context.scopeNodeId || context.reading || context.sourceId) return;
    }
    if (node.kind === "questions") {
      const scoped = validChapter(data, data.nodes.get(questionSet(data, node)?.scopeNodeId));
      if (scoped) return source(scoped.sourceId);
    }
    if (node.kind === "path" || node.role === "stage" || (node.kind === "graph" && node.role !== "scope-graph")) return;
    if (node.kind === "book") return source(node.sourceId || node.anchor?.sourceId);
    if (node.kind === "chat" && (node.anchor?.sourceId || node.sourceId)) return source(node.anchor?.sourceId || node.sourceId);
  }
}

function nearestPaper(data, nodeId) {
  for (const node of walkParents(data.nodes, nodeId)) {
    if (node.kind === "chat" || isSourcePaper(data, node) || validChapter(data, node)) return node;
  }
}

/** Sidebar locations and independent conversations; branches stay inside chats. */
export function projectNavigationNodes(project) {
  const data = model(project), projectRoot = project.paperTree?.rootId || null;
  const sourceNodes = [...data.nodes.values()].filter((node) => isSourcePaper(data, node));
  const readingRoot = sourceNodes.find((node) => data.sources.get(node.sourceId)?.kind === "pdf") || sourceNodes[0] || data.tutor;
  const projected = new Map(sourceNodes.map((node) => [node.id, { ...node, parentId: projectRoot }]));
  const sourceOrder = new Map(sourceNodes.map((node, index) => [node.sourceId, index]));
  const chapters = [...data.nodes.values()]
    .filter((node) => validChapter(data, node) && sourceOrder.has(node.sourceId))
    .sort((a, b) => sourceOrder.get(a.sourceId) - sourceOrder.get(b.sourceId) || a.anchor.page - b.anchor.page);
  const chapterIds = new Set(chapters.map((node) => node.id));
  // Physical page order restores outlines whose saved nodes were inserted later;
  // stable ties preserve same-page order, with conversations after each outline.
  // Old grouping/object nodes can be skipped without turning chapters into chats.
  for (const node of chapters) {
    const parent = [...walkParents(data.nodes, node.parentId)].find((ancestor) => chapterIds.has(ancestor.id) && ancestor.sourceId === node.sourceId);
    projected.set(node.id, { ...node, parentId: parent?.id || sourceNodes.find((source) => source.sourceId === node.sourceId).id });
  }
  for (const node of data.nodes.values()) {
    if (node.kind !== "chat" || rootFor(data, node.id)?.id !== node.id) continue;
    // Object-specific conversations only become visible within their card. Their
    // existence must not create another independent entry in the reading guide.
    const context = chatContext(data, node);
    const savedParent = data.nodes.get(node.parentId);
    if (context?.objectNodeId || (savedParent && ["graph", "questions", "paper"].includes(savedParent.kind))) continue;
    const ancestor = nearestPaper(data, node.parentId);
    const scope = ownerFor(data, node.id);
    const enclosingLocation = [...walkParents(data.nodes, node.parentId)]
      .find((parent) => validChapter(data, parent) || isSourcePaper(data, parent));
    // Legacy roots can be stored under Tutor or another conversation. Show their
    // reading location without exposing that storage edge as another chat level.
    const hasFixedContext = !!(context?.scopeNodeId || context?.reading || context?.sourceId);
    const location = scope?.role === "chapter" && projected.has(scope.id) ? scope
      : hasFixedContext ? sourceRoot(data, node.id) || readingRoot
        : ancestor?.role === "chapter" && projected.has(ancestor.id) ? ancestor
          : sourceRoot(data, node.id) || enclosingLocation;
    projected.set(node.id, { ...node, parentId: location?.id || (readingRoot?.id !== node.id ? readingRoot?.id : null) || projectRoot });
  }
  // A corrupt historical cycle must not hide papers or mutate saved ancestry.
  for (const node of projected.values()) {
    const chain = traceChain(node, (current) => projected.get(current.parentId));
    if (chain.cycleStart < 0) continue;
    const first = chain.nodes.slice(chain.cycleStart).sort((a, b) => a.id.localeCompare(b.id))[0];
    projected.set(first.id, { ...first, parentId: sourceRoot(data, first.id)?.id || projectRoot });
  }
  return [...projected.values()];
}

/** Child papers select their main conversation; objects reveal their owner. */
export function projectNavigationId(project, nodeId) {
  const data = model(project), visible = new Map(projectNavigationNodes(project).map((node) => [node.id, node]));
  if (visible.has(nodeId)) return nodeId;
  const root = rootFor(data, nodeId);
  if (root && visible.has(root.id)) return root.id;
  const parent = nearestPaper(data, nodeId);
  if (parent?.kind === "chat") {
    const rootId = rootFor(data, parent.id)?.id;
    if (visible.has(rootId)) return rootId;
    const owner = ownerFor(data, parent.id);
    if (owner?.role === "chapter" && visible.has(owner.id)) return owner.id;
    return [...visible.values()].find((node) => isSourcePaper(data, node))?.id || data.tutor?.id || "";
  }
  return parent && visible.has(parent.id) ? parent.id : sourceRoot(data, nodeId)?.id || data.tutor?.id || "";
}

/** New papers retain their nearest PDF/chapter/chat parent; scope is independent. */
export function newConversationParent(project, nodeId, _reading) {
  const data = model(project);
  return nearestPaper(data, nodeId) || data.tutor;
}
