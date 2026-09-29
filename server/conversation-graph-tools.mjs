import { randomUUID } from "node:crypto";

export const conversationGraphToolDefinition = {
  name: "create_conversation_graph",
  description: "当用户希望用知识图谱梳理刚才或当前对话的概念、推理与关联时使用；产物是当前对话中的独立图谱卡片，不改项目或章节图谱。不用于自动整理教材全章，也不将旧的用户请求当本轮命令。无需教材引用；基于对话整理，无原文依据的概念不得冒充教材结论。可选 anchors 只能引用本轮已读的来源与 PDF 物理页。每轮最多两个图谱，每图 1–20 节点。nodes[].id 是本次图谱内的短标识，links 只能引用同批标识；运行时会添加图谱命名空间并在返回的 nodeIds 中给出映射。参数错误时整图不创建，不静默截断；完全相同的成功调用幂等。返回 id、title、count、nodeIds，界面单独渲染卡片。",
  parameters: {
    type: "object", required: ["title", "nodes"], additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      nodes: {
        type: "array", minItems: 1, maxItems: 20,
        items: {
          type: "object", required: ["id", "name", "description", "links"], additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1, maxLength: 60, pattern: "^[a-zA-Z0-9_-]+$" },
            name: { type: "string", minLength: 1, maxLength: 100 },
            description: { type: "string", minLength: 1, maxLength: 1000 },
            links: { type: "array", maxItems: 12, uniqueItems: true, items: { type: "string" } },
            anchors: {
              type: "array", maxItems: 3,
              items: {
                type: "object", required: ["sourceId", "page"], additionalProperties: false,
                properties: { sourceId: { type: "string" }, page: { type: "integer", minimum: 1 } },
              },
            },
          },
        },
      },
    },
  },
};

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = (value) => JSON.stringify(value, (_key, item) => plainObject(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);

export function createConversationGraphTools() {
  const graphs = [], successful = new Map();
  const summaries = () => graphs.map(({ id, title, concepts }) => ({ id, title, count: concepts.length, basis: "conversation" }));
  const execute = (action, evidence = []) => {
    const issues = [];
    const issue = (path, message) => issues.push({ path, message });
    const fail = (code, message) => ({ ok: false, tool: "create_conversation_graph", error: { code, message, issues } });
    if (!plainObject(action)) return fail("invalid_arguments", "参数必须是对象。");
    const { tool: _tool, ...args } = action;
    const key = canonical(args);
    if (successful.has(key)) return { ...successful.get(key), replayed: true };
    if (graphs.length >= 2) return fail("graph_budget", "本轮已创建两个对话图谱，没有继续创建；请在下一轮继续。");
    const unknown = (value, allowed, path) => {
      for (const field of Object.keys(value)) if (!allowed.includes(field)) issue(`${path}${field}`, "不支持此字段；图谱只保存本轮对话内容，不接收项目或章节归属。");
    };
    const string = (value, path, max) => {
      if (typeof value !== "string" || !value.trim() || value.length > max)
        issue(path, `应为非空字符串，最多 ${max} 字符；不会自动截断。`);
    };
    unknown(args, ["title", "nodes"], "");
    string(args.title, "title", 120);
    if (!Array.isArray(args.nodes) || args.nodes.length < 1 || args.nodes.length > 20)
      issue("nodes", "每张图谱须有 1–20 个节点，不会自动截断。");
    const nodes = Array.isArray(args.nodes) ? args.nodes : [];
    const ids = new Set(nodes.filter(plainObject).map((node) => node.id));
    const visited = new Set(), anchorsByNode = new Map();
    for (const [index, node] of nodes.entries()) {
      const path = `nodes[${index}].`;
      if (!plainObject(node)) { issue(path, "节点必须是对象。"); continue; }
      unknown(node, ["id", "name", "description", "links", "anchors"], path);
      if (typeof node.id !== "string" || !/^[a-zA-Z0-9_-]{1,60}$/.test(node.id)) issue(`${path}id`, "使用 1–60 位字母、数字、下划线或短横线的图内标识，例如 decision。");
      if (visited.has(node.id)) issue(`${path}id`, "同一图谱内的节点标识不能重复。");
      visited.add(node.id);
      string(node.name, `${path}name`, 100);
      string(node.description, `${path}description`, 1000);
      if (!Array.isArray(node.links) || node.links.length > 12) issue(`${path}links`, "应为最多 12 个图内节点标识的数组。");
      else {
        const links = new Set();
        node.links.forEach((id, i) => {
          if (typeof id !== "string" || !ids.has(id) || id === node.id || links.has(id))
            issue(`${path}links[${i}]`, "关联只能指向本图中其他节点，不能重复，也不能引用项目或其他章节的节点。");
          links.add(id);
        });
      }
      if (node.anchors !== undefined && (!Array.isArray(node.anchors) || node.anchors.length > 3))
        issue(`${path}anchors`, "来源为最多 3 个本轮已读页面；纯对话内容可省略来源。");
      const anchors = [];
      for (const [i, anchor] of (Array.isArray(node.anchors) ? node.anchors : []).entries()) {
        const anchorPath = `${path}anchors[${i}]`;
        if (!plainObject(anchor)) { issue(anchorPath, "来源必须包含 sourceId 和 page。"); continue; }
        unknown(anchor, ["sourceId", "page"], `${anchorPath}.`);
        const source = evidence.find((item) => item.sourceId === anchor.sourceId && item.page === anchor.page);
        if (typeof anchor.sourceId !== "string" || !Number.isInteger(anchor.page) || anchor.page < 1 || !source)
          issue(anchorPath, "此来源与物理页尚未在本轮读取；先 read_pages 核实，或对纯对话概念省略来源。");
        else anchors.push({ sourceId: source.sourceId, title: source.title || source.sourceId, page: source.page });
      }
      anchorsByNode.set(node.id, anchors);
    }
    if (issues.length) return fail("invalid_arguments", "对话图谱未创建，请修正列出的字段后重试。");
    const id = `dialog-graph-${randomUUID()}`;
    const nodeIds = Object.fromEntries(nodes.map((node) => [node.id, `${id}:${node.id}`]));
    graphs.push({
      id, title: args.title,
      concepts: nodes.map((node, index) => ({
        id: nodeIds[node.id], name: node.name, description: node.description,
        links: node.links.map((link) => nodeIds[link]), anchors: anchorsByNode.get(node.id),
        x: 12 + (index % 4) * 25, y: 12 + Math.floor(index / 4) * 18, group: 0,
      })),
    });
    const result = { ok: true, tool: "create_conversation_graph", ...summaries().at(-1), nodeIds, replayed: false };
    successful.set(key, result);
    return result;
  };
  return { execute, summaries, conversationGraphs: () => structuredClone(graphs) };
}
