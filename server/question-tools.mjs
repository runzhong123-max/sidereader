import { randomUUID } from "node:crypto";

const anchorSchema = {
  type: "object",
  required: ["sourceId", "page"],
  additionalProperties: false,
  properties: { sourceId: { type: "string" }, page: { type: "integer", minimum: 1 } },
};

export const questionToolDefinition = {
  name: "create_question_set",
  description:
    "在用户要求练习、检测理解、巩固熟练度，或当前教学目标适合一次简短检查时使用。inline 为对话内 1–2 道随堂题；collection 为可重开的 1–12 道练习文件。普通解释、用户拒绝出题或仅要求已有作答反馈时不用。generated 是新编题，必须提供答案；textbook 是从本轮已读原文摘取的习题，每题必须有可核对的来源，当前版本不导入标准答案。每轮最多两个产物；输入错误会返回具体字段，修正后可重试，完全相同的成功调用幂等。",
  parameters: {
    type: "object",
    required: ["title", "origin", "presentation", "questions"],
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      description: { type: "string", maxLength: 1000 },
      origin: { enum: ["generated", "textbook"] },
      presentation: { enum: ["inline", "collection"] },
      questions: {
        type: "array", minItems: 1, maxItems: 12,
        items: {
          type: "object",
          required: ["type", "prompt", "options", "answer", "explanation"],
          additionalProperties: false,
          properties: {
            type: { enum: ["choice", "boolean", "short"] },
            prompt: { type: "string", minLength: 1, maxLength: 4000 },
            options: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 1000 } },
            answer: { type: "string", maxLength: 4000 },
            explanation: { type: "string", maxLength: 4000 },
            hint: { type: "string", maxLength: 1000 },
            sourceQuestionNumber: { type: "string", maxLength: 80 },
            anchors: { type: "array", minItems: 1, maxItems: 3, items: anchorSchema },
          },
        },
      },
    },
  },
};

const plainObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const canonical = (x) => JSON.stringify(x, function (_key, value) {
  return plainObject(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
    : value;
});
// Ignore OCR line breaks and fullwidth layout, never signs, decimal points or
// variable case: removing punctuation can turn a different equation into a match.
const sourceText = (x) => x.normalize("NFKC").replace(/\s/gu, "");

export function createQuestionTools() {
  const sets = [], successful = new Map();
  const summaries = () => sets.map(({ id, title, origin, presentation, questions }) => ({
    id, title, origin, presentation, count: questions.length,
    answerStatus: origin === "textbook" ? "missing" : "provided",
  }));

  const execute = (action, evidence = []) => {
    const issues = [];
    const issue = (path, message) => issues.push({ path, message });
    const fail = (code, message) => ({
      ok: false, tool: "create_question_set", error: { code, message, issues },
    });
    if (!plainObject(action)) return fail("invalid_arguments", "参数必须是对象。");
    const { tool: _tool, ...args } = action;
    const key = canonical(args);
    if (successful.has(key)) return { ...successful.get(key), replayed: true };
    if (sets.length >= 2) return fail("question_budget", "本轮已创建两个练习产物；没有再创建，请在下一轮继续。");
    const unknown = (value, allowed, path) => {
      for (const key of Object.keys(value)) if (!allowed.includes(key)) issue(`${path}${key}`, "不支持此字段；ID 和所属章节由运行时确定。");
    };
    const string = (value, path, max, required = true) => {
      if (value === undefined && !required) return;
      if (typeof value !== "string" || value.length > max || (required && !value.trim()))
        issue(path, `应为${required ? "非空" : ""}字符串，最多 ${max} 字符；不会自动截断。`);
    };
    unknown(args, ["title", "description", "origin", "presentation", "questions"], "");
    string(args.title, "title", 120);
    string(args.description, "description", 1000, false);
    if (!["generated", "textbook"].includes(args.origin)) issue("origin", "使用 generated 或 textbook。");
    if (!["inline", "collection"].includes(args.presentation)) issue("presentation", "使用 inline（对话检测）或 collection（练习文件）。");
    if (!Array.isArray(args.questions) || !args.questions.length || args.questions.length > 12)
      issue("questions", "每次须提供 1–12 道完整题目；不会自动截断。");
    if (args.presentation === "inline" && args.questions?.length > 2)
      issue("questions", "inline 只容纳 1–2 道随堂题；连续练习应使用 collection。");
    const normalizedQuestions = [];
    for (const [index, q] of (Array.isArray(args.questions) ? args.questions : []).entries()) {
      const path = `questions[${index}].`;
      if (!plainObject(q)) { issue(path, "题目必须是对象。"); continue; }
      unknown(q, ["type", "prompt", "options", "answer", "explanation", "hint", "sourceQuestionNumber", "anchors"], path);
      if (!["choice", "boolean", "short"].includes(q.type)) issue(`${path}type`, "使用 choice、boolean 或 short。");
      string(q.prompt, `${path}prompt`, 4000);
      string(q.answer, `${path}answer`, 4000, false);
      string(q.explanation, `${path}explanation`, 4000, false);
      if (typeof q.answer !== "string") issue(`${path}answer`, "必须提供字符串；教材原题未导入答案时填空字符串。");
      if (typeof q.explanation !== "string") issue(`${path}explanation`, "必须提供字符串；没有解析时填空字符串。");
      string(q.hint, `${path}hint`, 1000, false);
      string(q.sourceQuestionNumber, `${path}sourceQuestionNumber`, 80, false);
      if (!Array.isArray(q.options) || q.options.length > 8)
        issue(`${path}options`, "必须是最多 8 项的字符串数组；简答题为空数组。");
      else q.options.forEach((option, i) => string(option, `${path}options[${i}]`, 1000));
      if (q.type === "choice" && (!Array.isArray(q.options) || q.options.length < 2)) issue(`${path}options`, "选择题至少提供两个选项。");
      if (q.type === "short" && q.options?.length !== 0) issue(`${path}options`, "简答题使用空数组。");
      if (q.type === "boolean" && JSON.stringify(q.options) !== '["正确","错误"]') issue(`${path}options`, "判断题的选项固定为 [\"正确\",\"错误\"]。");
      if (args.origin === "generated") {
        if (typeof q.answer !== "string" || !q.answer.trim()) issue(`${path}answer`, "新编题必须有参考答案。");
        if (["choice", "boolean"].includes(q.type) && (!/^(0|[1-7])$/.test(q.answer) || Number(q.answer) >= (q.options?.length || 0)))
          issue(`${path}answer`, "答案必须是从 0 起、在选项范围内的索引字符串。");
      } else if (args.origin === "textbook" && (q.answer !== "" || q.explanation !== "" || (q.hint !== undefined && q.hint !== ""))) {
        issue(`${path}answer`, "教材摘题目前只收原题，answer、explanation、hint 须为空；不得将推测答案当教材标准答案。");
      }
      const anchors = [];
      if (q.anchors !== undefined && (!Array.isArray(q.anchors) || !q.anchors.length || q.anchors.length > 3))
        issue(`${path}anchors`, "来源须为 1–3 个已读页面。");
      for (const [i, anchor] of (Array.isArray(q.anchors) ? q.anchors : []).entries()) {
        const anchorPath = `${path}anchors[${i}]`;
        if (!plainObject(anchor)) { issue(anchorPath, "来源必须包含 sourceId 和 page。"); continue; }
        unknown(anchor, ["sourceId", "page"], `${anchorPath}.`);
        const pages = evidence.filter((e) => e.sourceId === anchor.sourceId && e.page === anchor.page);
        if (typeof anchor.sourceId !== "string" || !Number.isInteger(anchor.page) || anchor.page < 1 || !pages.length)
          issue(anchorPath, "此来源/物理页尚未在本轮读取；先调用 read_pages，不能沿用历史引用。");
        else anchors.push({ sourceId: anchor.sourceId, page: anchor.page, title: pages[0].title || anchor.sourceId });
      }
      if (args.origin === "textbook") {
        if (!anchors.length) issue(`${path}anchors`, "教材原题必须带本轮已读来源页。");
        const original = sourceText(anchors.flatMap((anchor) => evidence.filter((e) => e.sourceId === anchor.sourceId && e.page === anchor.page).map((e) => e.text)).join("\n"));
        if (typeof q.prompt === "string" && (!sourceText(q.prompt) || !original.includes(sourceText(q.prompt))))
          issue(`${path}prompt`, "题干未与所引原文匹配。请保留原题措辞；改编题必须标为 generated。");
        if (q.type === "choice" && Array.isArray(q.options)) q.options.forEach((option, i) => {
          if (typeof option === "string" && !original.includes(sourceText(option))) issue(`${path}options[${i}]`, "选项未在所引原文找到，不能为教材原题编造选项。");
        });
        if (q.sourceQuestionNumber && typeof q.sourceQuestionNumber === "string" && !original.includes(sourceText(q.sourceQuestionNumber)))
          issue(`${path}sourceQuestionNumber`, "原题编号未在所引原文找到。");
      }
      normalizedQuestions.push({ ...q, answerStatus: args.origin === "textbook" ? "missing" : "provided", ...(anchors.length ? { anchors } : {}) });
    }
    if (issues.length) return fail("invalid_arguments", "练习未创建。请修正列出的字段后重试。");
    const anchors = [...new Map(normalizedQuestions.flatMap((q) => q.anchors || []).map((a) => [`${a.sourceId}:${a.page}`, a])).values()];
    const set = {
      id: `questions-${randomUUID()}`, title: args.title, description: args.description || "",
      origin: args.origin, presentation: args.presentation,
      questions: normalizedQuestions.map((q) => ({ ...q, id: `question-${randomUUID()}` })),
      ...(anchors.length ? { anchors } : {}),
    };
    sets.push(set);
    const result = { ok: true, tool: "create_question_set", ...summaries().at(-1), replayed: false };
    successful.set(key, result);
    return result;
  };
  return { execute, summaries, questionSets: () => structuredClone(sets) };
}
