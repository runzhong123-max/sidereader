import { revertProjectUpdate } from "./project-updates.mjs";
import { canonicalProposalReferences } from "./proposal-references.mjs";

/** Undo one proposal while retaining entities referenced by other paper results. */
export function revertPaperProposal(project, receipt, parentId, messageId) {
  const referenced = { concepts: new Set(), stages: new Set() };
  const parent = project.paperTree?.nodes.find((node) => node.id === parentId);
  const originChatId = parent?.kind === "chat" ? parent.objectId || parent.id : parentId;
  for (const chat of project.chats || []) {
    for (const message of chat.messages || []) {
      if (!message.proposalApplied || (chat.id === originChatId && message.id === messageId)) continue;
      const canonical = canonicalProposalReferences(project, message.proposal, message.proposalUndo);
      for (const field of ["concepts", "stages"]) {
        for (const id of message.proposalReferences?.[field] || canonical[field]) referenced[field].add(id);
      }
    }
  }
  for (const node of project.paperTree?.nodes || []) {
    if (node.role === "stage" || node.role === "scope-graph") continue;
    if (node.parentId === parentId && node.sourceMessageId === messageId) continue;
    for (const id of node.conceptIds || []) referenced.concepts.add(id);
    for (const id of node.stageIds || []) referenced.stages.add(id);
  }

  let retainedByPapers = 0;
  const filtered = { ...receipt };
  for (const field of ["concepts", "stages"]) {
    const live = new Set((project[field] || []).map((item) => item.id));
    const retainedIds = new Set();
    filtered[field] = (receipt[field] || []).filter((entry) => {
      if (!live.has(entry.id) || !referenced[field].has(entry.id)) return true;
      retainedIds.add(entry.id);
      return false;
    });
    retainedByPapers += retainedIds.size;
  }

  // The original undo still protects later edits and dependencies. A retained
  // paper entity becomes an ordinary live root for its linked prerequisites.
  const result = revertProjectUpdate(project, filtered);
  return { project: result.project, retained: result.retained + retainedByPapers };
}
