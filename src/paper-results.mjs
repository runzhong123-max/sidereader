import { parseAnswer } from "./learning-objects.mjs";
import { attachPaperNode, nodeTitle, addProposalNodes } from "./paper-tree-state.mjs";
import { captureConversationGraphs, restoreConversationGraphs } from "./conversation-graphs.mjs";

/** Register completed outputs under their originating paper without navigating. */
export function capturePaperResults(project, parentId, messages) {
  let next = project;
  const parent = project.paperTree?.nodes.find((node) => node.id === parentId);
  if (!parent) return project;
  for (const message of messages) {
    if (message.role !== "assistant" || message.error) continue;
    next = captureConversationGraphs(next, parentId, message);
    const objects = parseAnswer(message.content, message.id).flatMap((part) => part.object ? [part.object] : []);
    if (message.evidence?.length) objects.push({
      id: `${message.id}:retrieval`, kind: "tool", title: "本次检索结果",
      content: message.evidence.map((item, index) => `### ${index + 1}. ${item.title} · 第 ${item.page} 页\n${item.text}`).join("\n\n"),
    });
    for (const object of objects) {
      if (next.papers?.some((paper) => paper.object.id === object.id)) continue;
      const id = `result:${encodeURIComponent(parentId)}:${encodeURIComponent(object.id)}`;
      const paper = {
        id, parentId, parentTab: parent, parentTitle: nodeTitle(next, parent),
        title: object.title, sourceMessageId: message.id, object,
        evidence: message.evidence || [], created: new Date().toISOString(),
      };
      next = attachPaperNode({...next, papers:[...(next.papers || []),paper]}, {
        id, kind:"paper", objectId:id, parentId, sourceMessageId:message.id,
        origin:object.kind === "tool" ? "tool" : "object", anchor:message.readingContext, created:paper.created,
      });
    }
  }
  return next;
}

/** Old applied proposals have known provenance; recover it without guessing for legacy objects. */
export function restoreProposalBranches(project) {
  let next=restoreConversationGraphs(project);
  for(const chat of project.chats || []) {
    const parent=next.paperTree?.nodes.find((node)=>node.kind === "chat" && (node.objectId || node.id) === chat.id);
    if(!parent) continue;
    for(const message of chat.messages) {
      if(message.proposalApplied && message.proposal) next=addProposalNodes(next,parent.id,message.id,message.proposal,message.proposalUndo);
    }
  }
  return next;
}
