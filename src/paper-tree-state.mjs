import { resolvePaperObject } from "./paper-state.mjs";
import { sourceSections } from "./source-sections.mjs";
import { knowledgeGraphOwner } from "./knowledge-scope.mjs";
import { canonicalProposalReferences } from "./proposal-references.mjs";
import { indexById, parentChain, walkParents, traceChain, createRelationIndex, chapterRange } from "./domain/relations.mjs";
import { surfaceDefinition } from "./domain/objects.mjs";

const KINDS = new Set(["chat", "book", "graph", "path", "questions", "paper"]);

function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  const other = Object.keys(b).filter((key) => b[key] !== undefined);
  return keys.length === other.length && keys.every((key) => equal(a[key], b[key]));
}

function tabFor(node) {
  return {
    id: node.id,
    kind: node.kind,
    ...(node.sourceId ? { sourceId: node.sourceId } : {}),
    ...(node.objectId ? { objectId: node.objectId } : {}),
  };
}

const isSourceNode = (node) => node.kind === "book" && (!node.role || node.role === "source");

// Shared book/paper chat IDs remain addressable for old messages and branches.
// Their old container names are not conversation topics.
function legacyConversationTitle(project, node) {
  const chat = project.chats?.find((item) => item.id === node.objectId);
  const source = project.sources?.find((item) => `book:${item.id}` === node.objectId);
  const paper = project.papers?.find((item) => item.id === node.objectId);
  const title = chat?.title?.trim();
  const placeholders = new Set(["阅读讨论", "新的对话", "新对话", "新的话题", "追问", source?.title?.trim(), paper?.title?.trim()]);
  if (title && !placeholders.has(title)) return title;
  const question = chat?.messages?.find((message) => message.role === "user" && message.content?.trim())?.content;
  const topic = question?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`#]/g, "").replace(/\s+/g, " ").trim();
  const chars = Array.from(topic || "");
  return chars.length ? chars.slice(0, 34).join("") + (chars.length > 34 ? "…" : "") : "未命名对话";
}

/** Pure migration to a virtual project root with one tutor and source branches. */
export function normalizePaperTree(project) {
  const tree = project.paperTree;
  if (tree && tree.version !== 1 && tree.version !== 2)
    throw new Error(`Unsupported paper tree version: ${tree.version}`);
  const oldNodes = tree?.nodes || [];
  const oldById = indexById(oldNodes);
  const sources = project.sources || [];
  const sourceById = indexById(sources);
  const papers = project.papers || [];
  const sets = project.sets || [];
  const stages = project.stages || [];
  const bookmarks = project.bookmarks || [];
  const chats = project.chats || [];
  const oldTabs = project.tabs || [];
  const rootId = `project:${project.id}`;
  const sharedChats = new Set([
    ...sources.map((source) => `book:${source.id}`),
    ...papers.map((paper) => paper.id),
    ...oldNodes.filter((node) => isSourceNode(node) || node.kind === "paper").map((node) => node.id),
    ...oldNodes.filter((node) => node.kind === "chat" && node.id.startsWith("discussion:") && node.objectId).map((node) => node.objectId),
    ...chats.filter((chat) => /^(book|paper):/.test(chat.id)).map((chat) => chat.id),
  ]);
  const previousTutorId = tree?.version === 2 ? tree.tutorId : tree?.rootId;
  const oldTutor = oldNodes.find((node) => node.id === previousTutorId && node.kind === "chat" && !sharedChats.has(node.objectId || node.id));
  const mainChat = chats.find((chat) => !sharedChats.has(chat.id));
  const originalTutorId = oldTutor?.id || mainChat?.id || `main:${project.id}`;
  const tutorId = originalTutorId === rootId ? `tutor:${project.id}` : originalTutorId;
  const tutor = {
    ...(oldTutor || { id: tutorId, kind: "chat" }), id: tutorId,
    ...(originalTutorId === rootId ? { objectId: oldTutor?.objectId || originalTutorId } : {}),
    parentId: rootId, origin: "root",
  };
  const tutorChatId = tutor.objectId || tutorId;
  const missingTutorChat = !chats.some((chat) => chat.id === tutorChatId);
  const nextChats = missingTutorChat ? [...chats, { id: tutorChatId, title: "项目 Tutor", messages: [] }] : chats;
  const sourceNodes = new Map(sources.map((source) => {
    const existing = oldNodes.find((node) => isSourceNode(node) && node.sourceId === source.id);
    return [source.id, existing?.id || `book:${source.id}`];
  }));
  const sections = sources.flatMap((source) => sourceSections(source).map((section) => ({ ...section, sourceId: source.id })));
  const sectionById = indexById(sections);
  const removedParents = new Map();
  const retainedChapters = new Set();
  for (const node of oldNodes) {
    const survives = node.role === "chapter" ? sectionById.has(node.id)
      : node.role === "bookmark" ? bookmarks.some((item) => item.id === node.bookmarkId && sourceById.has(item.sourceId))
      : isSourceNode(node) ? sourceById.has(node.sourceId)
      : node.role === "stage" ? stages.some((item) => item.id === node.stageId)
      : node.kind === "paper" ? papers.some((item) => item.id === (node.objectId || node.id))
      : node.kind === "questions" && node.objectId ? sets.some((item) => item.id === node.objectId)
      : true;
    if (!survives) continue;
    for (const parent of walkParents(oldById, node.parentId)) {
      if (parent.role === "chapter") retainedChapters.add(parent.id);
    }
  }
  const nodes = [];
  const byId = new Map();
  const invalidIds = new Set();

  function sourceParent(sourceId) { return sourceNodes.get(sourceId) || tutorId; }
  function firstAnchor(stage) {
    return stage.anchors?.find((anchor) => sourceById.has(anchor.sourceId) && Number.isFinite(anchor.page) && anchor.page > 0);
  }
  function canonical(candidate) {
    if (!candidate?.id || !KINDS.has(candidate.kind) || candidate.id === rootId) return null;
    let node = candidate;
    if (node.kind === "book") {
      const sourceId = node.sourceId || node.anchor?.sourceId || (node.id.startsWith("book:") ? node.id.slice(5) : undefined);
      if (!sourceById.has(sourceId)) { removedParents.set(node.id, tutorId); return null; }
      node = { ...node, sourceId };
      if (node.role === "chapter") {
        const section = sectionById.get(node.id);
        if (!section && !retainedChapters.has(node.id)) { removedParents.set(node.id, sourceParent(sourceId)); return null; }
        if (section) node = {
          ...node, title: section.title, sectionKind: section.kind, endPage: section.endPage,
          anchor: { sourceId, page: section.page, title: section.title },
          parentId: section.parentId || sourceParent(sourceId),
        };
      } else if (node.role === "bookmark") {
        const bookmarkId = node.bookmarkId || (node.id.startsWith("bookmark:") ? node.id.slice(9) : undefined);
        const bookmark = bookmarks.find((item) => item.id === bookmarkId && item.sourceId === sourceId);
        if (!bookmark) { removedParents.set(node.id, sourceParent(sourceId)); return null; }
        node = { ...node, bookmarkId, anchor: bookmark, parentId: sourceParent(sourceId) };
      } else {
        node = { ...node, role: "source", parentId: rootId };
      }
    } else if (node.role === "stage") {
      const stageId = node.stageId || (node.id.startsWith("stage:") ? node.id.slice(6) : undefined);
      const stage = stages.find((item) => item.id === stageId);
      if (!stage) { removedParents.set(node.id, tutorId); return null; }
      const anchor = firstAnchor(stage);
      node = { ...node, id: `stage:${stage.id}`, kind: "path", stageId: stage.id, stageIds: [stage.id], parentId: "path" };
      if (anchor) { node.anchor = anchor; node.sourceId = anchor.sourceId; }
      else { delete node.anchor; delete node.sourceId; }
    } else if (node.kind === "paper") {
      const objectId = node.objectId || node.id;
      if (!papers.some((paper) => paper.id === objectId)) { removedParents.set(node.id, tutorId); return null; }
      node = { ...node, objectId };
    } else if (node.kind === "questions") {
      const objectId = node.id === "questions" ? undefined : node.objectId || (node.id.startsWith("questions:") ? node.id.slice(10) : undefined);
      if (objectId && !sets.some((set) => set.id === objectId)) { removedParents.set(node.id, tutorId); return null; }
      if (!objectId && node.id !== "questions") return null;
      if (objectId) node = { ...node, objectId };
    } else if (node.kind === "chat" && sharedChats.has(node.objectId || node.id)) {
      const objectId = node.objectId || node.id;
      const legacyId = node.id === objectId;
      node = {
        ...node, id: legacyId ? `discussion:${objectId}` : node.id, objectId,
        parentId: legacyId && (!node.parentId || node.parentId === rootId || node.parentId === tutorId) ? objectId : node.parentId || objectId,
      };
    }
    if (node.id === "graph" || node.id === "path" || node.id === "questions") {
      node = { ...node, kind: node.id, parentId: tutorId };
      delete node.conceptIds; delete node.stageIds; delete node.role;
      if (node.id === "questions") delete node.objectId;
    } else if (node.kind === "path" && node.role !== "stage") {
      // Keep saved selections addressable, including their descendants and
      // message receipts, without presenting another project learning map.
      node = { ...node, role: "history", title: node.title || "关卡更新记录" };
    } else if (node.kind === "graph" && !(node.role === "scope-graph" &&
      (sectionById.has(node.parentId) || (retainedChapters.has(node.parentId) && sourceById.has(oldById.get(node.parentId)?.sourceId))))) {
      // Even an empty old graph can be open or own discussions. Preserve its
      // identity rather than aliasing it to the unrelated project graph.
      node = { ...node, role: "history", title: node.title || (oldById.get(node.parentId)?.role === "stage" ? "关卡知识记录" : "知识记录") };
    }
    return node;
  }
  function append(candidate) {
    const node = canonical(candidate);
    if (!node) { if (candidate?.id) invalidIds.add(candidate.id); return; }
    if (byId.has(node.id)) return;
    const next = node.id === tutorId ? tutor : { ...node, parentId: node.parentId || tutorId, origin: node.origin || "legacy" };
    nodes.push(next); byId.set(next.id, next);
  }
  if (!oldNodes.some((node) => node.id === tutorId)) append(tutor);
  for (const node of oldNodes) append(node.id === originalTutorId ? tutor : node);
  if (!byId.has(tutorId)) append(tutor);
  for (const source of sources) {
    if (!nodes.some((node) => isSourceNode(node) && node.sourceId === source.id))
      append({ id: sourceParent(source.id), kind: "book", sourceId: source.id, role: "source", parentId: rootId, origin: "import" });
  }
  append({ id: "graph", kind: "graph", parentId: tutorId, origin: "legacy" });
  append({ id: "path", kind: "path", parentId: tutorId, origin: "legacy" });
  append({ id: "questions", kind: "questions", parentId: tutorId, origin: "legacy" });
  for (const section of sections) append({ id: section.id, kind: "book", role: "chapter", sourceId: section.sourceId, parentId: section.parentId || sourceParent(section.sourceId), origin: "import" });
  for (const bookmark of bookmarks) append({ id: `bookmark:${bookmark.id}`, kind: "book", role: "bookmark", bookmarkId: bookmark.id, sourceId: bookmark.sourceId, parentId: sourceParent(bookmark.sourceId), origin: "manual" });
  for (const stage of stages) append({ id: `stage:${stage.id}`, kind: "path", role: "stage", stageId: stage.id, parentId: "path", origin: "object" });

  function contextFields(context) {
    return {
      ...(context?.sourceMessageId ? { sourceMessageId: context.sourceMessageId } : {}),
      ...(context?.quote ? { quote: context.quote } : {}),
      ...(context?.reading ? { anchor: context.reading } : {}),
      ...(context?.sourceId ? { sourceId: context.sourceId } : {}),
    };
  }
  for (const tab of oldTabs) {
    if (byId.has(tab.id) || invalidIds.has(tab.id)) continue;
    const paper = tab.kind === "paper" ? papers.find((item) => item.id === (tab.objectId || tab.id)) : undefined;
    const context = tab.kind === "chat" ? chats.find((chat) => chat.id === (tab.objectId || tab.id))?.context : undefined;
    append({
      ...tab, parentId: paper?.parentId || context?.parentId || tutorId,
      origin: paper ? "object" : context ? "selection" : "legacy", ...contextFields(context),
      ...(paper?.sourceMessageId ? { sourceMessageId: paper.sourceMessageId } : {}),
      ...(paper?.created ? { created: paper.created } : {}),
    });
  }
  for (const chat of nextChats) {
    if (sharedChats.has(chat.id) || nodes.some((node) => node.kind === "chat" && (node.objectId || node.id) === chat.id)) continue;
    append({ id: chat.id, kind: "chat", parentId: chat.context?.parentId || tutorId, origin: chat.context ? "selection" : "legacy", ...contextFields(chat.context) });
  }
  for (const paper of papers) {
    if (nodes.some((node) => node.kind === "paper" && (node.objectId || node.id) === paper.id)) continue;
    append({ id: paper.id, kind: "paper", objectId: paper.id, parentId: paper.parentId || tutorId, origin: "object",
      ...(paper.sourceMessageId ? { sourceMessageId: paper.sourceMessageId } : {}), ...(paper.created ? { created: paper.created } : {}),
    });
  }
  for (const set of sets) {
    if (!nodes.some((node) => node.kind === "questions" && node.objectId === set.id))
      append({ id: `questions:${set.id}`, kind: "questions", objectId: set.id, parentId: tutorId, origin: "legacy" });
  }
  for (const chat of nextChats) {
    if (!sharedChats.has(chat.id)) continue;
    const id = `discussion:${chat.id}`;
    const explicitlyOpen = oldTabs.some((tab) => tab.kind === "chat" && (tab.id === id || tab.id === chat.id || tab.objectId === chat.id));
    if (chat.messages?.length || explicitlyOpen) append({ id, kind: "chat", objectId: chat.id, parentId: chat.id, origin: "legacy" });
  }

  function setParent(id, parentId) {
    const previous = byId.get(id);
    if (previous.parentId !== parentId) byId.set(id, { ...previous, parentId });
  }
  for (const node of nodes) {
    if (node.id === tutorId || isSourceNode(node)) { setParent(node.id, rootId); continue; }
    if (node.id === "graph" || node.id === "path" || node.id === "questions") { setParent(node.id, tutorId); continue; }
    const context = node.kind === "chat" ? nextChats.find((chat) => chat.id === (node.objectId || node.id))?.context : undefined;
    const contextSource = context?.sourceId || context?.reading?.sourceId || node.anchor?.sourceId || node.sourceId;
    const oldParent = node.parentId;
    const missingParent = !byId.has(oldParent);
    let parentId = oldParent;
    if (removedParents.has(oldParent)) parentId = removedParents.get(oldParent);
    else if (missingParent || oldParent === node.id || oldParent === rootId) parentId = tutorId;
    if (node.kind === "chat" && (missingParent || oldParent === rootId || oldParent === tutorId)) {
      if (context?.scopeNodeId && byId.has(context.scopeNodeId)) parentId = context.scopeNodeId;
      else if (sourceNodes.has(contextSource)) parentId = sourceParent(contextSource);
    }
    setParent(node.id, parentId);
  }
  for (const node of nodes) {
    const chain = traceChain(byId.get(node.id), (current) => current.parentId === rootId ? undefined : byId.get(current.parentId));
    if (chain.cycleStart >= 0) setParent(chain.nodes[chain.cycleStart].id, tutorId);
  }
  const normalizedNodes = nodes.map((node) => {
    const normalized = byId.get(node.id);
    const original = oldById.get(node.id);
    return original && equal(original, normalized) ? original : normalized;
  });
  const normalizedTree = { version: 2, rootId, tutorId, nodes: normalizedNodes };
  const nextTabs = [];
  const tabIds = new Set();
  let activeTab = project.activeTab;
  for (const tab of oldTabs) {
    const legacyDiscussion = tab.kind === "chat" && sharedChats.has(tab.objectId || tab.id);
    const normalized = (!legacyDiscussion ? byId.get(tab.id) : undefined) || canonical(tab.id === originalTutorId && originalTutorId === rootId ? { ...tab, id: tutorId, objectId: tutorChatId } : tab);
    if (!normalized || !byId.has(normalized.id) || tabIds.has(normalized.id)) continue;
    const next = { ...tab, ...tabFor(normalized) };
    if (tab.id === activeTab) activeTab = next.id;
    nextTabs.push(equal(tab, next) ? tab : next); tabIds.add(next.id);
  }
  if (missingTutorChat && !tabIds.has(tutorId)) nextTabs.push(tabFor(tutor));
  if (!nextTabs.length) nextTabs.push(tabFor(tutor));
  if (!nextTabs.some((tab) => tab.id === activeTab)) activeTab = nextTabs[0].id;
  const stableTree = equal(tree, normalizedTree) ? tree : normalizedTree;
  const stableTabs = equal(oldTabs, nextTabs) ? project.tabs : nextTabs;
  if (stableTree === tree && stableTabs === project.tabs && nextChats === project.chats && activeTab === project.activeTab) return project;
  return { ...project, paperTree: stableTree, tabs: stableTabs, chats: nextChats, activeTab };
}

/** Resolve live titles; only an explicit node title overrides its entity. */
export function nodeTitle(project, node) {
  if (node.id === project.paperTree?.tutorId) return "项目 Tutor";
  if (["graph", "path", "questions"].includes(node.id)) return surfaceDefinition(node.id).projectTitle;
  if (node.title?.trim() && !(node.kind === "chat" && node.title.trim() === "阅读讨论")) return node.title;
  if (node.role === "stage") return project.stages?.find((stage) => stage.id === node.stageId)?.title || "学习关卡";
  if (node.role === "bookmark") {
    const bookmark = project.bookmarks?.find((item) => item.id === node.bookmarkId);
    const title = bookmark?.quote?.trim() || bookmark?.title || node.anchor?.title || `第 ${node.anchor?.page || 1} 页`;
    return title.length > 28 ? `${title.slice(0, 28)}…` : title;
  }
  if (node.role === "chapter") return node.anchor?.title || "章节";
  if (node.kind === "book") return project.sources?.find((source) => source.id === node.sourceId)?.title || "原文";
  if (node.kind === "paper") {
    const paper = project.papers?.find((paper) => paper.id === (node.objectId || node.id));
    return paper ? resolvePaperObject(project, paper).title || paper.title || surfaceDefinition("paper").title : surfaceDefinition("paper").title;
  }
  if (node.kind === "questions") return project.sets?.find((set) => set.id === node.objectId)?.title || surfaceDefinition("questions").title;
  if (node.kind === "graph") return surfaceDefinition("graph").title;
  if (node.kind === "path") return surfaceDefinition("path").title;
  if (node.kind === "chat" && node.objectId && node.id !== node.objectId) return legacyConversationTitle(project, node);
  return project.chats?.find((chat) => chat.id === (node.objectId || node.id))?.title || "新的对话";
}

/** Ancestors in root-to-parent order, excluding the node itself. */
export function paperAncestors(project, nodeId) {
  return parentChain(indexById(project.paperTree?.nodes), nodeId).slice(1).reverse();
}

/** Attach once; reopening an existing node never changes its parent or tab. */
export function attachPaperNode(project, candidate) {
  // Insert before normalizing entity pools: the caller may have just appended
  // the entity, and its explicit parent must win over migration's root fallback.
  const next = project.paperTree ? project : normalizePaperTree(project);
  if (next.paperTree.nodes.some((node) => node.id === candidate.id)) return normalizePaperTree(next);
  const parentId = next.paperTree.nodes.some((node) => node.id === candidate.parentId)
    ? candidate.parentId : next.paperTree.rootId;
  return normalizePaperTree({
    ...next,
    paperTree: { ...next.paperTree, nodes: [...next.paperTree.nodes, { ...candidate, parentId }] },
  });
}

export function scopeGraphId(parentId) {
  return `scope-graph:${encodeURIComponent(parentId)}`;
}

/** Materialize a chapter graph without opening it; the tutor uses global graph. */
export function ensureScopeGraph(project, parentId) {
  const next = normalizePaperTree(project);
  const parent = next.paperTree.nodes.find((node) => node.id === parentId);
  if (!chapterRange(createRelationIndex(next), parent)) return next;
  if (next.paperTree.nodes.some((node) => node.id === scopeGraphId(parentId))) return next;
  return attachPaperNode(next, {
    id: scopeGraphId(parentId), kind: "graph", role: "scope-graph", parentId,
    origin: "object", conceptIds: [],
  });
}

/** Apply canonical results to their owning graph; provenance stays on the message. */
export function addProposalNodes(project, parentId, messageId, proposal, receipt) {
  let next = normalizePaperTree(project);
  const parent = next.paperTree.nodes.some((node) => node.id === parentId) ? parentId : next.paperTree.tutorId;
  const parentNode = next.paperTree.nodes.find((node) => node.id === parent);
  const chatId = parentNode?.kind === "chat" ? parentNode.objectId || parentNode.id : parentId;
  const references = canonicalProposalReferences(next, proposal, receipt);
  const legacyResults = next.paperTree.nodes.filter((node) => node.parentId === parent && node.sourceMessageId === messageId);
  const chats = next.chats.map((chat) => {
    if (chat.id !== chatId) return chat;
    let changed = false;
    const messages = chat.messages.map((message) => {
      if (message.id !== messageId) return message;
      const proposalReferences = {
        concepts: [...new Set([...(message.proposalReferences?.concepts || []), ...references.concepts, ...legacyResults.flatMap((node) => node.conceptIds || [])])],
        stages: [...new Set([...(message.proposalReferences?.stages || []), ...references.stages, ...legacyResults.flatMap((node) => node.stageIds || [])])],
      };
      if (equal(message.proposalReferences, proposalReferences)) return message;
      changed = true;
      return { ...message, proposalReferences };
    });
    return changed ? { ...chat, messages } : chat;
  });
  if (chats.some((chat, index) => chat !== next.chats[index])) next = { ...next, chats };
  // Project concepts and stages have already been merged. The global graph
  // and the one project map read these pools directly, so they need no clone.
  const ids = references.concepts;
  if (!ids.length) return next;
  const owner = knowledgeGraphOwner(next, parent);
  if (owner?.role !== "chapter") return next;
  const result = ensureScopeGraph(next, owner.id);
  const graph = result.paperTree.nodes.find((node) => node.id === scopeGraphId(owner.id));
  const conceptIds = [...new Set([...(graph.conceptIds || []), ...ids])];
  if (equal(conceptIds, graph.conceptIds)) return result;
  return { ...result, paperTree: { ...result.paperTree, nodes: result.paperTree.nodes.map((node) => node.id === graph.id ? { ...node, conceptIds } : node) } };
}
