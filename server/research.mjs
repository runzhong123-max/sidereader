import { readFileSync } from "node:fs";
import { buildCatalog, coverage } from "./catalog.mjs";
import { retrieve } from "./retrieval.mjs";
import { buildTutorMessages, historyContext, clip } from "./tutor-context.mjs";
import { maintainObjects } from "./project-tools.mjs";
import { createQuestionTools, questionToolDefinition } from "./question-tools.mjs";
import { createConversationGraphTools, conversationGraphToolDefinition } from "./conversation-graph-tools.mjs";
const prompt = readFileSync(
  new URL("./prompts/research.md", import.meta.url),
  "utf8",
);
const skills = Object.fromEntries(
  ["knowledge-graph", "learning-path"].map((n) => [
    n,
    readFileSync(new URL(`./prompts/skills/${n}.md`, import.meta.url), "utf8"),
  ]),
);
export const isDeep = (input) =>
  input.researchMode === "deep" ||
  (input.mode === "project" &&
    /总体|整体|全局|纵览|全貌|学习规[划劃]|学习[路计]线|学习计划|roadmap|overview|全面|深度研究/i.test(
      input.question,
    ));
export function declinesObjectMaintenance(question = "") {
  // Match an explicit refusal attached to a maintenance verb and object. Do not
  // treat "不要只生成…" (do more) or "不是不要生成…" as a refusal.
  const refusal =
    /(?:暂(?:时)?不|先不|不要|不必|不用|无需|不需要|先别|别|禁止|不)\s*(?:再|自动|直接|为我|立即|现在)?\s*(?:修改|变更|更新|维护|生成|新增|创建|调整|增删|保存|应用|改动|改)\s*(?:(?:任何|新的?|现有的?|已有的?|我的?|本项目的?|项目的?|这些|这个|相关的?|的)\s*)*(?:学习对象|项目对象|知识图谱|概念图|关卡图?|学习路径|对象|图谱)/g;
  for (const match of question.matchAll(refusal)) {
    const before = question.slice(0, match.index);
    if (!/(?:不是(?:说|要)?|并非|不要|不用|无需|不必|不需要)\s*$/.test(before))
      return true;
  }
  return /\b(?:do not|don't|never)\s+(?:modify|update|create|generate|maintain)\s+(?:(?:the|any|existing|learning|project)\s+)*(?:objects?|knowledge graph|learning path|stages?)\b/i.test(
    question,
  );
}
export const wantsConversationGraph = (input) =>
  /知识图谱|概念图|关系图|图谱|concept map|knowledge graph/i.test(input.question || "") &&
  /刚才|刚刚|前面|上述|上面|当前对话|本次对话|这(?:段|次|场)(?:对话|讨论)|对话(?:内容|逻辑|关系)|讨论(?:内容|逻辑)|conversation|discussion|what we (?:just )?discussed/i.test(input.question || "");
export const wantsObjects = (input) =>
  input.mode === "project" &&
  !wantsConversationGraph(input) &&
  !declinesObjectMaintenance(input.question) &&
  (isDeep(input) ||
    /知识图谱|概念图|节点|关卡|第[一二三四五六七八九十\d]+关|学习路径/.test(
      input.question,
    ));
export async function research(
  input,
  { complete, semantic, signal, progress = () => {} },
) {
  const started = Date.now(),
    deep = isDeep(input) && !wantsConversationGraph(input),
    maintain = wantsObjects(input),
    maxRounds = deep ? 3 : 2;
  const catalog = buildCatalog(input.chunks),
    evidenceMap = new Map(),
    trace = [],
    seen = new Set(),
    loadedSkills = new Set();
  const questionTools = createQuestionTools(), questionToolResults = [];
  const conversationGraphTools = createConversationGraphTools(), graphToolResults = [];
  const metrics = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageReported: false,
  };
  const emit = (tool, summary, count = 0) => {
    const item = { tool, summary, count };
    trace.push(item);
    progress(item);
  };
  const add = (items) => {
    let retained = 0;
    for (const c of items)
      if (evidenceMap.size < 40 || evidenceMap.has(c.id)) {
        evidenceMap.set(c.id, { ...c, text: clip(c.text, 1800) });
        retained++;
      }
    if (retained < items.length)
      emit(
        "budget",
        `证据预算已满：本次 ${items.length} 个候选仅保留 ${retained} 个，其他内容未装载`,
      );
    return retained;
  };
  const view = () => [...evidenceMap.values()];
  const call = async (messages, json, maxTokens) => {
    signal?.throwIfAborted();
    metrics.calls++;
    return complete(messages, json, {
      signal,
      maxTokens,
      onUsage: (u) => {
        if (u) {
          metrics.usageReported = true;
          metrics.inputTokens += u.prompt_tokens || 0;
          metrics.outputTokens += u.completion_tokens || 0;
        }
      },
    });
  };
  emit(
    "catalog",
    `已建立 ${catalog.sources.length} 个来源、${catalog.sections.length} 个目录项的全库视图`,
    catalog.totalPages,
  );
  // Reading anchors are inserted first so fusion cannot displace the active page.
  if (input.mode === "learning" && input.anchor) {
    add(
      input.chunks.filter(
        (c) =>
          c.sourceId === input.anchor.sourceId && c.page === input.anchor.page,
      ),
    );
    add(
      input.chunks
        .filter(
          (c) =>
            c.sourceId === input.anchor.sourceId &&
            Math.abs(c.page - input.anchor.page) === 1,
        )
        .slice(0, 5),
    );
    emit(
      "reading",
      `装载当前第 ${input.anchor.page} 页及相邻页；选区与可见文本优先`,
      view().length,
    );
  }
  if (deep) {
    const sections =
      catalog.sections.length <= 24
        ? catalog.sections
        : Array.from(
            { length: 24 },
            (_, i) =>
              catalog.sections[
                Math.floor((i * (catalog.sections.length - 1)) / 23)
              ],
          );
    for (const s of sections)
      add(
        input.chunks
          .filter((c) => c.sourceId === s.sourceId && c.page === s.startPage)
          .slice(0, 1),
      );
    emit("overview", "按目录跨章节抽读，建立全局证据骨架", view().length);
  } else
    add(
      retrieve(input.chunks, input.question, input.anchor, [
        input.selected || "",
        clip(input.visibleText, 800),
      ]),
    );
  if (semantic)
    try {
      const candidates = new Map(
        [
          ...view(),
          ...retrieve(input.chunks, input.question, input.anchor),
        ].map((c) => [c.id, c]),
      );
      for (let i = 0; i < 96 && candidates.size < 96; i++) {
        const c = input.chunks[Math.floor((i * input.chunks.length) / 96)];
        if (c) candidates.set(c.id, c);
      }
      const results = (
        await semantic([...candidates.values()], input.question, signal)
      ).slice(0, 4);
      const retained = add(results);
      emit(
        "semantic",
        `在 ${candidates.size} 个有界候选中补充语义检索，避免首次提问向量化整库`,
        retained,
      );
    } catch (e) {
      if (signal?.aborted) throw e;
      emit("warning", "语义检索暂不可用，继续目录与关键词检索");
    }
  if (maintain) {
    loadedSkills.add("knowledge-graph");
    loadedSkills.add("learning-path");
    emit("read_skill", "已载入知识图谱与学习关卡维护规范");
  }
  let gaps = [],
    stopReason = "budget",
    rounds = 0,
    catalogOffset = 0;
  for (let round = 0; round < maxRounds && complete; round++) {
    signal?.throwIfAborted();
    rounds++;
    emit(
      "plan",
      deep
        ? `研究第 ${round + 1} 轮：检查章节覆盖与待补信息`
        : `检查阅读上下文，第 ${round + 1} 轮`,
    );
    let decision;
    try {
      decision = JSON.parse(
        await call(
          [
            { role: "system", content: prompt },
            {
              role: "user",
              content: JSON.stringify({
                mode: deep ? "deep" : "qa",
                objectMaintenanceAllowed: maintain,
                availableTools: [questionToolDefinition, conversationGraphToolDefinition],
                createdQuestions: questionTools.summaries(),
                createdConversationGraphs: conversationGraphTools.summaries(),
                question: input.question,
                goal: clip(input.goal, 1200),
                reading: {
                  anchor: input.anchor,
                  selected: clip(input.selected, 1800),
                  visibleText: clip(input.visibleText, 1800),
                },
                history: historyContext(input.history).messages,
                omittedHistoryMessages: historyContext(input.history).omittedMessages,
                paper: clip(
                  JSON.stringify(input.paperContext?.object || {}),
                  1800,
                ),
                remainingRounds: maxRounds - round - 1,
                catalog: catalog.sections.slice(
                  catalogOffset,
                  catalogOffset + 60,
                ),
                catalogTotal: catalog.sections.length,
                coverage: coverage(catalog, view()),
                evidence: view().map((e, i) => ({
                  citation: i + 1,
                  id: e.id,
                  sourceId: e.sourceId,
                  page: e.page,
                  text: e.text,
                })),
                completedActions: [...seen],
                toolResults: [...trace.slice(-10), ...questionToolResults.slice(-4), ...graphToolResults.slice(-4)],
                skills: [...loadedSkills].map((n) => ({
                  name: n,
                  content: skills[n],
                })),
              }),
            },
          ],
          true,
          6500,
        ),
      );
    } catch (e) {
      if (signal?.aborted) throw e;
      emit("warning", "研究调度未返回有效结果，保留已读证据进行综合");
      stopReason = "planner-error";
      break;
    }
    gaps = Array.isArray(decision.gaps)
      ? decision.gaps
          .filter((x) => typeof x === "string")
          .slice(0, 8)
          .map((x) => clip(x, 180))
      : [];
    const readBeforeDecision = trace.some((t) =>
      ["read_pages", "read_section", "search"].includes(t.tool) && t.count > 0,
    );
    const actions = Array.isArray(decision.actions)
      ? decision.actions.slice(0, 3)
      : [];
    let executed = 0, questionToolFailed = false, graphToolFailed = false;
    for (const action of actions) {
      if (!action || typeof action !== "object") continue;
      const key = JSON.stringify(action);
      if (seen.has(key)) continue;
      executed++;
      let result = [];
      if (action.tool === "create_conversation_graph") {
        const output = conversationGraphTools.execute(action, view());
        graphToolResults.push(output);
        if (output.ok) {
          seen.add(key);
          emit("create_conversation_graph", `已整理对话图谱：${output.title}（${output.count} 个概念）`, output.count);
        } else {
          graphToolFailed = true;
          emit("tool-error", output.error.message);
        }
        continue;
      }
      if (action.tool === "create_question_set") {
        const output = questionTools.execute(action, view());
        questionToolResults.push(output);
        if (output.ok) {
          seen.add(key);
          emit("create_question_set", `已准备${output.presentation === "inline" ? "随堂检测" : "练习"}：${output.title}（${output.count} 题）`, output.count);
        } else {
          questionToolFailed = true;
          emit("tool-error", output.error.message);
        }
        continue;
      }
      seen.add(key);
      if (action.tool === "search" && typeof action.query === "string") {
        result = retrieve(
          input.chunks.filter(
            (c) => !action.sourceId || c.sourceId === action.sourceId,
          ),
          action.query.slice(0, 400),
          null,
        );
        const retained = add(result);
        emit("search", `搜索：${action.query.slice(0, 100)}`, retained);
      } else if (
        action.tool === "read_pages" &&
        typeof action.sourceId === "string" &&
        Number.isInteger(action.startPage)
      ) {
        const end = Number.isInteger(action.endPage)
          ? Math.min(
              action.startPage + 2,
              Math.max(action.startPage, action.endPage),
            )
          : action.startPage;
        result = input.chunks
          .filter(
            (c) =>
              c.sourceId === action.sourceId &&
              c.page >= action.startPage &&
              c.page <= end,
          )
          .slice(0, 8);
        const retained = add(result);
        emit("read_pages", `补读物理页 ${action.startPage}–${end}`, retained);
      } else if (action.tool === "read_section") {
        const section = catalog.sections.find((s) => s.id === action.sectionId);
        if (section) {
          const middle = Math.floor((section.startPage + section.endPage) / 2);
          result = input.chunks
            .filter(
              (c) =>
                c.sourceId === section.sourceId &&
                [section.startPage, section.startPage + 1, middle].includes(
                  c.page,
                ),
            )
            .slice(0, 7);
          const retained = add(result);
          emit("read_section", `抽读：${section.title}`, retained);
        } else emit("tool-error", "目录项不存在，请使用目录中的 sectionId");
      } else if (action.tool === "catalog") {
        catalogOffset = Math.max(
          0,
          Math.min(
            catalog.sections.length - 1,
            Number.isInteger(action.offset) ? action.offset : 0,
          ),
        );
        emit("catalog", `查看第 ${catalogOffset + 1} 项起的目录`);
      } else if (
        action.tool === "read_skill" &&
        skills[action.name] &&
        maintain
      ) {
        loadedSkills.add(action.name);
        emit("read_skill", `载入 ${action.name}`);
      } else emit("tool-error", "工具或参数无效，未执行");
    }
    // A finishing decision can also contain a creation action. Run it first,
    // and give structured validation failures another planning round to repair.
    if (questionToolFailed || graphToolFailed) {
      if (round === maxRounds - 1) {
        if (questionToolFailed) gaps.push("部分练习未通过题目或来源校验，未创建这些题目。");
        if (graphToolFailed) gaps.push("部分对话图谱未通过节点或来源校验，未创建这些图谱。");
      }
      continue;
    }
    if (decision.finish === true) {
      if (deep && !readBeforeDecision) {
        gaps = [...gaps, "关键规划依据尚未主动补读验证，或尚未在下一轮检查返回结果。"];
        emit("validation", "覆盖检查未通过：初始章节抽样不能替代主动研究，请先补读关键定义或先修依据");
        continue;
      }
      stopReason = "sufficient";
      break;
    }
    if (!executed) {
      stopReason = "no-new-actions";
      break;
    }
    if (evidenceMap.size >= 40) {
      stopReason = "evidence-budget";
      break;
    }
  }
  const evidence = view(),
    cov = coverage(catalog, evidence);
  const report = {
    mode: deep ? "deep" : "qa",
    rounds,
    stopReason,
    coverage: cov,
    gaps,
    trace,
    metrics,
    catalogCacheHit: catalog.cacheHit,
    elapsedMs: Date.now() - started,
  };
  if (!complete)
    return {
      answer: "模型未连接。已整理目录与相关原文；连接模型后可进行逐轮研究。",
      evidence,
      research: report,
      routes: ["目录导航", "关键词检索"],
      mode: "retrieval",
      questionSets: [],
      conversationGraphs: [],
    };
  emit("synthesize", "正在依据研究证据整理回答与下一步行动", evidence.length);
  const prepared = buildTutorMessages({
    ...input,
    evidence,
    research: report,
    catalog: catalog.sections,
  });
  prepared.messages.splice(2, 0, {
    role: "system",
    content: `本轮出题工具执行结果：${JSON.stringify(questionTools.summaries())}。这些题目会由界面单独渲染，答案只在提交后展示。已成功创建时，用正常文字简述练习目的，不再逐题重复、不在正文或新对象中泄露答案。空数组表示没有成功创建题目，不得声称已经出题或以 question 围栏绕过工具。工具错误：${JSON.stringify(questionToolResults.filter((r) => !r.ok))}。如用户要求出题但未创建成功，说明具体缺口。`,
  });
  prepared.messages.splice(2, 0, {
    role: "system",
    content: `本轮对话图谱工具执行结果：${JSON.stringify(conversationGraphTools.summaries())}。这些图谱是基于当前对话整理的独立快照，界面会在回答旁显示卡片，不会更新项目或章节图谱。成功时仅用一句话说明用途，不能再用 ASCII、Mermaid、Markdown 列表或 JSON 重画同一张图，不增加重复图示对象；遵守用户要求的正文长度。不声称覆盖教材或已修改项目。空数组表示没有创建对话图谱。工具错误：${JSON.stringify(graphToolResults.filter((result) => !result.ok))}。历史上下文有省略时，不能声称覆盖整段历史对话。`,
  });
  // A local conversation artifact never doubles as a project-wide mutation.
  // Explicit project/chapter graph generation retains its existing path.
  const synthesizeMaintenance = maintain && conversationGraphTools.summaries().length === 0;
  if (synthesizeMaintenance)
    prepared.messages.splice(2, 0, {
      role: "system",
      content: `${skills["knowledge-graph"]}\n${skills["learning-path"]}\n本轮综合返回JSON {"answer":"Markdown研究报告", "tools":[maintain_graph参数,maintain_path参数]}。回答包含材料结构、依赖与阶段、可验证产物和下一步；没有证据的部分明确说明。tools是提案工具调用，交给运行时校验，不能声称已经保存。已有对象ID在context.projectState里。`,
    });
  else if (declinesObjectMaintenance(input.question))
    prepared.messages.splice(2, 0, {
      role: "system",
      content:
        "用户本轮明确暂不维护学习对象。正常完成资料研究、分析与文字规划，但不生成知识图谱或关卡更新提案，不输出对象维护工具调用，也不要求用户保存对象。",
    });
  const raw = await call(prepared.messages, synthesizeMaintenance, synthesizeMaintenance ? 6500 : 4000);
  let answer = raw,
    proposal;
  if (synthesizeMaintenance) {
    try {
      const result = JSON.parse(raw);
      if (typeof result.answer !== "string" || !result.answer.trim())
        throw new Error();
      answer = result.answer;
      proposal = maintainObjects(result.tools, evidence, input.projectState);
      emit(
        "maintain_graph",
        `校验图谱提案：${proposal.concepts.length} 个概念`,
        proposal.concepts.length,
      );
      emit(
        "maintain_path",
        `校验关卡提案：${proposal.stages.length} 个关卡`,
        proposal.stages.length,
      );
    } catch {
      answer =
        "已完成资料研究，但规划输出格式无效，未修改项目对象。请重试本次规划。";
      emit("warning", "规划格式无效；未应用任何对象变更");
    }
  }
  report.elapsedMs = Date.now() - started;
  return {
    answer,
    evidence,
    proposal,
    questionSets: questionTools.questionSets(),
    conversationGraphs: conversationGraphTools.conversationGraphs(),
    research: report,
    mode: "model",
    routes: [
      "查询规划",
      "目录导航",
      ...(deep ? ["深度研究"] : []),
      "关键词检索",
      ...(trace.some((t) => t.tool === "semantic") ? ["语义检索"] : []),
      ...(input.mode === "project" ? ["领域纵览"] : []),
      ...(input.visibleText ? ["可见区域"] : []),
      ...(input.pageImage ? ["页面视觉"] : []),
      ...(input.anchor ? ["阅读位置"] : []),
    ],
  };
}
