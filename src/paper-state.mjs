import { questionObject } from "./question-state.mjs";

/** Generated objects are snapshots; file question papers reference the editable original. */
export function resolvePaperObject(project, paper) {
  if (paper.object.kind === "question") {
    for (const set of project.sets || []) {
      for (const question of set.questions || []) {
        const current = questionObject(set.id, question);
        if (current.id === paper.object.id) return { ...paper.object, ...current };
      }
    }
  }
  return paper.object;
}

/** Opening a paper never duplicates its object, chat, or parent relationship. */
export function openPaper(project, candidate) {
  const existing = (project.papers || []).find(
    (p) => p.object.id === candidate.object.id,
  );
  const resolved = resolvePaperObject(project, existing || candidate);
  const paper = {
    ...(existing || candidate),
    object: resolved,
    title: resolved.title || existing?.title || candidate.title,
  };
  return {
    ...project,
    papers: existing
      ? project.papers.map((p) => (p.id === paper.id ? paper : p))
      : [...(project.papers || []), paper],
    tabs: project.tabs.some((t) => t.id === paper.id)
      ? project.tabs
      : [...project.tabs, { id: paper.id, kind: "paper", objectId: paper.id }],
    activeTab: paper.id,
  };
}
export function addAttempt(project, attempt) {
  if (project.attempts?.some((a) => a.id === attempt.id)) return project;
  return { ...project, attempts: [...(project.attempts || []), attempt] };
}
