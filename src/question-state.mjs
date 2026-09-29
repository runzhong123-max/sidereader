/** Question identity is stable; a revision separates results after meaningful edits. */
export function questionRevision(question) {
  const fields = [
    question.type,
    question.prompt,
    question.options,
    question.answer,
  ];
  // Preserve the existing q1 hash for every question with an answer key.
  // A missing textbook key must not reuse a previously graded revision.
  if (question.answerStatus === "missing") fields.push("answer-missing");
  const value = JSON.stringify(fields);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `q1:${value.length}:${(hash >>> 0).toString(16)}`;
}

export function questionView(objectId, question, attempts = [], drafts = {}) {
  const revision = questionRevision(question);
  const draft =
    drafts[objectId]?.revision === revision ? drafts[objectId] : undefined;
  const matching = attempts.filter(
    (attempt) =>
      attempt.objectId === objectId &&
      (attempt.questionRevision === revision ||
        // Generated answer objects are immutable. Editable file questions cannot
        // safely reuse legacy scores whose original answer key was not recorded.
        (!objectId.startsWith("question:") &&
          question.answerStatus !== "missing" &&
          !attempt.questionRevision &&
          attempt.prompt === question.prompt)),
  );
  const latest = matching
    .filter((attempt) => attempt.result !== "hint-viewed")
    .at(-1);
  const result = draft?.retry ? undefined
    : question.answerStatus === "missing" && latest && latest.result !== "skipped"
      ? { ...latest, result: "needs-review" }
      : latest;
  const storedAnswer =
    latest?.answerValue ??
    (question.type === "short"
      ? latest?.answer || ""
      : latest && question.options.includes(latest.answer)
        ? String(question.options.indexOf(latest.answer))
        : "");
  return {
    revision,
    answer: draft?.answer ?? storedAnswer,
    hint: draft?.hint === true,
    retry: draft?.retry === true,
    result,
    assisted: draft?.hint === true || matching.some((attempt) => attempt.result !== "skipped"),
  };
}

export function questionObject(setId, question) {
  return {
    id: `question:${setId}:${question.id}`,
    kind: "question",
    title: question.prompt.slice(0, 40) || "题目",
    content: "",
    question,
  };
}

export function practiceSummary(set, attempts = [], drafts = {}) {
  const summary = {
    total: set.questions.length,
    submitted: 0,
    objectiveSubmitted: 0,
    objectiveCorrect: 0,
    selfReviewed: 0,
    selfCorrect: 0,
    needsReview: 0,
    unanswered: 0,
  };
  for (const question of set.questions) {
    const { result } = questionView(
      questionObject(set.id, question).id,
      question,
      attempts,
      drafts,
    );
    if (!result || result.result === "skipped") {
      summary.unanswered++;
      continue;
    }
    summary.submitted++;
    if (question.answerStatus === "missing" || result.result === "needs-review") {
      summary.needsReview++;
    } else if (question.type !== "short") {
      summary.objectiveSubmitted++;
      if (result.result === "correct") summary.objectiveCorrect++;
    } else if (["self-correct", "self-incorrect"].includes(result.result)) {
      summary.selfReviewed++;
      if (result.result === "self-correct") summary.selfCorrect++;
    } else summary.needsReview++;
  }
  return summary;
}
