/**
 * Content kinds and workspace surfaces are separate concepts. A learning object
 * keeps its content identity when shown in an answer, beside a PDF, or floating.
 * A paper is the persisted view/source snapshot for that identity, not a new kind
 * of content. Keep these keys stable: existing projects persist them locally.
 */
const object = (kind, label, renderer = "markdown") => Object.freeze({
  kind, label, renderer, canCompare: true, canFloat: true,
});

export const objectDefinitions = Object.freeze({
  code: object("code", "代码", "code"),
  pseudocode: object("pseudocode", "伪代码", "code"),
  ascii: object("ascii", "ASCII 图", "code"),
  plot: object("plot", "图表", "plot"),
  table: object("table", "表格"),
  formula: object("formula", "公式", "formula"),
  question: object("question", "题目", "question"),
  trace: object("trace", "执行轨迹", "trace"),
  concept: object("concept", "概念卡"),
  source: object("source", "原文片段"),
  tool: object("tool", "检索结果"),
  note: object("note", "笔记"),
});

export const objectLabels = Object.freeze(Object.fromEntries(
  Object.entries(objectDefinitions).map(([kind, definition]) => [kind, definition.label]),
));

export function objectDefinition(kind) {
  return typeof kind === "string" && Object.hasOwn(objectDefinitions, kind)
    ? objectDefinitions[kind]
    : undefined;
}

const surface = (kind, title, projectTitle, scope, icon) => Object.freeze({
  kind, title, projectTitle, scope, icon, canCompare: true, canFloat: true,
});

export const surfaceDefinitions = Object.freeze({
  graph: surface("graph", "知识图谱", "项目知识图谱", "project-and-chapter", "network"),
  path: surface("path", "关卡图", "项目关卡图", "project", "route"),
  questions: surface("questions", "练习", "练习总览", "project-and-chapter", "practice"),
  paper: surface("paper", "学习对象", "学习对象", "origin", "object"),
});

export function surfaceDefinition(kind) {
  return typeof kind === "string" && Object.hasOwn(surfaceDefinitions, kind)
    ? surfaceDefinitions[kind]
    : undefined;
}
