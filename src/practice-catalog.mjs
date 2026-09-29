import { conversationOwner } from "./conversation-model.mjs";
import { parseAnswer } from "./learning-objects.mjs";
import { questionObject, questionView } from "./question-state.mjs";

function playable(object) {
  const q = object?.question;
  if (object?.kind !== "question" || !object.id || !q ||
      !["choice", "boolean", "short"].includes(q.type) ||
      typeof q.prompt !== "string" || !q.prompt.trim() ||
      typeof q.answer !== "string" || (!q.answer.trim() && q.answerStatus !== "missing") || !Array.isArray(q.options)) return false;
  return q.type === "short" || (q.options.length >= 2 &&
    q.options.every((option) => typeof option === "string" && option.trim()) &&
    (q.answerStatus === "missing" || /^\d+$/.test(q.answer) && Number(q.answer) < q.options.length));
}

function readingChapter(project, nodes, reading) {
  const source = project.sources?.find((item) => item.id === reading?.sourceId);
  if (!source || !Number.isInteger(reading?.page) || reading.page < 1 || reading.page > source.pages.length) return;
  return nodes.filter((node) => node.kind === "book" && node.role === "chapter" &&
    node.sourceId === source.id && Number.isInteger(node.anchor?.page) &&
    node.anchor.page >= 1 && Number.isInteger(node.endPage ?? source.pages.length) &&
    (node.endPage ?? source.pages.length) <= source.pages.length &&
    reading.page >= node.anchor.page && reading.page <= (node.endPage ?? source.pages.length))
    .sort((a, b) => ((a.endPage ?? source.pages.length) - a.anchor.page) -
      ((b.endPage ?? source.pages.length) - b.anchor.page))[0];
}

function scopeFor(project, nodes, originNodeId, reading) {
  const owner = originNodeId ? conversationOwner(project, originNodeId) : undefined;
  if (owner?.role === "chapter") return { scopeId: owner.id, scopeTitle: owner.title || "章节" };
  // A saved conversation scope remains authoritative even if its source was
  // deleted. Only otherwise unscoped questions use their own captured page.
  const seen = new Set();
  let node = nodes.find((item) => item.id === originNodeId);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const context = project.chats?.find((chat) => chat.id === (node.objectId || node.id))?.context;
    if (context?.scopeNodeId || context?.reading || context?.sourceId || node.kind === "chat" && node.anchor)
      return { scopeId: "project", scopeTitle: "项目" };
    node = nodes.find((item) => item.id === node.parentId);
  }
  const chapter = readingChapter(project, nodes, reading);
  return chapter ? { scopeId: chapter.id, scopeTitle: chapter.title || "章节" } : { scopeId: "project", scopeTitle: "项目" };
}

function progress(project, object) {
  const view = questionView(object.id, object.question, project.attempts, project.questionDrafts);
  if (!view.result) return {
    status: "unanswered",
    statusLabel: view.retry ? "待重做" : view.hint ? "已看提示，待作答" : "未作答",
  };
  switch (view.result.result) {
    case "skipped": return { status: "unanswered", statusLabel: "已跳过" };
    case "incorrect": return { status: "review", statusLabel: "回答有误" };
    case "self-incorrect": return { status: "review", statusLabel: "自评：需要补充" };
    case "needs-review": return { status: "review", statusLabel: object.question.answerStatus === "missing" ? "待核对" : "待自评" };
    case "self-correct": return view.result.assisted
      ? { status: "review", statusLabel: "参考解析后自评：基本正确" }
      : { status: "answered", statusLabel: "自评：基本正确" };
    case "correct": return view.result.assisted
      ? { status: "review", statusLabel: "参考提示或解析后答对" }
      : { status: "answered", statusLabel: "回答正确" };
    default: return { status: "unanswered", statusLabel: "未作答" };
  }
}

/** A read-only index: all practice surfaces share their original object identity. */
export function practiceCatalog(project) {
  const nodes = project.paperTree?.nodes || [];
  const entries = new Map();
  const fixedScopes = new Set();
  const currentQuestions = new Map();
  const put = (object, metadata, reading, fixedScope) => {
    if (!playable(object)) return;
    const entry = {
      id: object.id, object, ...metadata,
      ...(fixedScope || scopeFor(project, nodes, metadata.originNodeId, reading)),
      ...progress(project, object),
    };
    const existing = entries.get(object.id);
    if (!existing) {
      entries.set(object.id, entry);
      if (fixedScope) fixedScopes.add(object.id);
    }
    else {
      // Current editable questions win; snapshots can fill missing provenance.
      if (!existing.originNodeId && entry.originNodeId) {
        existing.originNodeId = entry.originNodeId;
        if (!fixedScopes.has(object.id)) {
          existing.scopeId = entry.scopeId;
          existing.scopeTitle = entry.scopeTitle;
        }
      }
      if (!existing.sourceMessageId && entry.sourceMessageId) existing.sourceMessageId = entry.sourceMessageId;
      if (!existing.evidence.length && entry.evidence.length) existing.evidence = entry.evidence;
    }
  };
  for (const set of project.sets || []) {
    const node = nodes.find((item) => item.kind === "questions" && item.objectId === set.id);
    const originNode = set.presentation === "inline" ? nodes.find((item) => item.id === node?.parentId) : node;
    const originChat = set.presentation === "inline" && project.chats?.find((chat) => chat.id === (originNode?.objectId || originNode?.id));
    const scopeNode = set.scopeNodeId && nodes.find((item) => item.id === set.scopeNodeId && item.role === "chapter");
    const scopeOwner = scopeNode && conversationOwner(project, scopeNode.id);
    const fixedScope = set.scopeNodeId
      ? scopeOwner?.role === "chapter" && scopeOwner.id === scopeNode?.id
        ? { scopeId: scopeOwner.id, scopeTitle: scopeOwner.title || "章节" }
        : { scopeId: "project", scopeTitle: "项目" }
      : undefined;
    for (const question of set.questions || []) {
      if (!question?.id || typeof question.prompt !== "string") continue;
      const object = questionObject(set.id, question);
      currentQuestions.set(object.id, object);
      put(object, {
        setId: set.id, originNodeId: originNode?.id, originTitle: originChat?.title || set.title || "题集",
        sourceMessageId: set.sourceMessageId, evidence: [],
      }, undefined, fixedScope);
    }
  }
  for (const paper of project.papers || []) {
    const object = currentQuestions.get(paper.object?.id) || paper.object;
    const parent = nodes.find((item) => item.id === paper.parentId);
    const node = nodes.find((item) => item.kind === "paper" && (item.objectId || item.id) === paper.id);
    const originNodeId = parent?.id || node?.id;
    const chat = project.chats?.find((item) => item.id === (parent?.objectId || parent?.id));
    const message = chat?.messages?.find((item) => item.id === paper.sourceMessageId);
    put(object, {
      originNodeId, sourceMessageId: paper.sourceMessageId,
      originTitle: chat?.title || paper.parentTitle || "已保存的题目",
      evidence: paper.evidence || message?.evidence || [],
    }, message?.readingContext || node?.anchor);
  }
  for (const chat of project.chats || []) {
    const node = nodes.find((item) => (item.objectId || item.id) === chat.id && ["chat", "paper"].includes(item.kind));
    for (const message of chat.messages || []) {
      if (message.role !== "assistant" || message.error || typeof message.content !== "string") continue;
      for (const part of parseAnswer(message.content, message.id)) {
        if (part.object?.kind !== "question") continue;
        put(part.object, {
          originNodeId: node?.id, sourceMessageId: message.id,
          originTitle: chat.title || "对话小测", evidence: message.evidence || [],
        }, message.readingContext);
      }
    }
  }
  return [...entries.values()];
}
