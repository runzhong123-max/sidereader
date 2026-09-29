import { objectDefinition, objectLabels } from "./domain/objects.mjs";
export { objectLabels } from "./domain/objects.mjs";
/** Versioned, inert learning objects. Never execute generated code or HTML. */
const text = (v, n = 16000) => (typeof v === "string" ? v.slice(0, n) : "");
export function normalizeObject(raw, id) {
  const definition = raw && objectDefinition(raw.kind);
  if (!definition) return null;
  const o = {
    id,
    kind: raw.kind,
    title: text(raw.title, 120) || definition.label,
    content: text(raw.content),
    language: text(raw.language, 40),
  };
  if (raw.kind === "question") {
    const q = raw.question;
    if (
      !q ||
      !["choice", "boolean", "short"].includes(q.type) ||
      !text(q.prompt).trim()
    )
      return null;
    const options =
      q.type === "boolean"
        ? ["正确", "错误"]
        : Array.isArray(q.options)
          ? q.options.slice(0, 8).map((x) => text(x, 500))
          : [];
    const answer = text(q.answer, 3000);
    if (
      q.type !== "short" &&
      (!/^\d$/.test(answer) || !options[Number(answer)] || options.length < 2)
    )
      return null;
    if (!answer.trim()) return null;
    o.question = {
      id,
      type: q.type,
      prompt: text(q.prompt, 3000),
      options,
      answer,
      explanation: text(q.explanation, 4000),
      hint: text(q.hint, 1000),
    };
  }
  if (raw.kind === "plot") {
    const p = raw.plot;
    if (
      !p ||
      !["line", "scatter", "bar"].includes(p.type) ||
      !Array.isArray(p.series)
    )
      return null;
    const series = p.series
      .slice(0, 6)
      .filter((s) => s && typeof s === "object")
      .map((s) => ({
        name: text(s.name, 80),
        points: (Array.isArray(s.points) ? s.points : [])
          .slice(0, 500)
          .filter(
            (x) =>
              Array.isArray(x) &&
              x.length === 2 &&
              x.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e12),
          )
          .map((x) => [x[0], x[1]]),
      }))
      .filter((s) => s.points.length);
    if (!series.length) return null;
    o.plot = {
      type: p.type,
      xLabel: text(p.xLabel, 80),
      yLabel: text(p.yLabel, 80),
      series,
    };
  }
  if (raw.kind === "trace") {
    o.steps = (Array.isArray(raw.steps) ? raw.steps : [])
      .slice(0, 40)
      .filter(
        (s) => s && typeof s === "object" && typeof s.content === "string",
      )
      .map((s) => ({
        title: text(s.title, 120),
        content: text(s.content, 3000),
      }));
    if (!o.steps.length) return null;
  }
  if (!o.content && !o.question && !o.plot && !o.steps) return null;
  return o;
}
export function parseAnswer(content, messageId) {
  const parts = [];
  let start = 0,
    index = 0;
  // Process fences first so math/table-looking text inside code stays literal.
  const re = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1\s*$/gm;
  const addText = (value) => {
    const math =
      /\$\$([\s\S]+?)\$\$|^\|[^\n]+\|\r?\n\|[ :|\-]+\|\r?\n(?:\|[^\n]*\|(?:\r?\n|$))+/gm;
    let offset = 0;
    for (const m of value.matchAll(math)) {
      if (value.slice(offset, m.index).trim())
        parts.push({ text: value.slice(offset, m.index) });
      parts.push({
        object: normalizeObject(
          {
            kind: m[1] ? "formula" : "table",
            title: m[1] ? "公式" : "对比表",
            content: m[1] ? m[1].trim() : m[0].trim(),
          },
          `${messageId}:object:${index++}`,
        ),
      });
      offset = m.index + m[0].length;
    }
    if (value.slice(offset).trim()) parts.push({ text: value.slice(offset) });
  };
  for (const m of content.matchAll(re)) {
    addText(content.slice(start, m.index));
    const lang = m[2].trim().toLowerCase();
    let object;
    if (lang === "sidereader-object") {
      try {
        object = normalizeObject(
          JSON.parse(m[3]),
          `${messageId}:object:${index++}`,
        );
      } catch {
        /* Keep malformed output visible. */
      }
    } else {
      const kind = ["ascii", "text-diagram"].includes(lang)
        ? "ascii"
        : ["pseudocode", "pseudo"].includes(lang)
          ? "pseudocode"
          : "code";
      object = normalizeObject(
        {
          kind,
          title: lang ? `${lang} · ${objectLabels[kind]}` : "代码",
          language: lang,
          content: m[3].replace(/\n$/, ""),
        },
        `${messageId}:object:${index++}`,
      );
    }
    parts.push(
      object
        ? { object }
        : {
            text:
              lang === "sidereader-object"
                ? "对象格式不完整，暂时无法显示。请让 Tutor 重新生成这个对象。"
                : m[0],
          },
    );
    start = m.index + m[0].length;
  }
  addText(content.slice(start));
  return parts;
}
export function gradeQuestion(question, answer, action = "submit") {
  if (action === "skip") return "skipped";
  if (!String(answer).trim()) return "unanswered";
  if (question.answerStatus === "missing" || question.type === "short") return "needs-review";
  return String(answer) === question.answer ? "correct" : "incorrect";
}
export function attemptContext(attempts) {
  return (Array.isArray(attempts) ? attempts : [])
    .filter((a) => a && typeof a === "object")
    .slice(-12)
    .map((a) => ({
      objectId: text(a.objectId, 160),
      questionRevision: text(a.questionRevision, 80),
      prompt: text(a.prompt, 1000),
      answer: text(a.answer, 1600),
      result: [
        "correct",
        "incorrect",
        "skipped",
        "needs-review",
        "self-correct",
        "self-incorrect",
        "hint-viewed",
      ].includes(a.result)
        ? a.result
        : "needs-review",
      assisted: a.assisted === true,
      feedback: text(a.feedback, 1200),
      at: text(a.at, 50),
    }));
}

/** Shared readable representation for cards and copying; generated code is inert. */
export function objectMarkdown(object) {
  const renderer = objectDefinition(object.kind)?.renderer;
  if (renderer === "formula") return `$$\n${object.content}\n$$`;
  if (renderer === "code") {
    const fence = "`".repeat(Math.max(3, ...(object.content.match(/`+/g) || []).map((s) => s.length + 1)));
    const language = object.kind === "code" ? object.language || "text" : "text";
    return `${fence}${language}\n${object.content}\n${fence}`;
  }
  return object.content;
}

/** Readable snapshots/copying must not expose an unsubmitted question's key. */
export function answerForPaper(content, messageId) {
  return parseAnswer(content, messageId)
    .map((part) => {
      if (!part.object) return part.text;
      const o = part.object;
      if (o.question)
        return `### ${o.title}\n${o.question.prompt}\n\n${o.question.options.map((v, i) => `${i + 1}. ${v}`).join("\n")}`;
      const renderer = objectDefinition(o.kind)?.renderer;
      if (renderer === "formula" || renderer === "code") return objectMarkdown(o);
      if (o.steps)
        return o.steps.map((s) => `### ${s.title}\n${s.content}`).join("\n\n");
      if (o.plot)
        return `### ${o.title}\n${o.content}\n\n${o.plot.xLabel} / ${o.plot.yLabel}\n${o.plot.series.map((s) => s.name + "\n" + s.points.map((p) => p.join(", ")).join("\n")).join("\n\n")}`;
      return `### ${o.title}\n${o.content}`;
    })
    .join("\n\n");
}
