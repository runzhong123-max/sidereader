/** Synthetic graphs for layout verification. Names mirror a textbook chapter;
 * links below are intentionally hand-authored test relationships, not evidence. */
export const GRAPH_FIXTURE_IDS = ["chapter", "cycle", "disconnected", "hundred", "far-pin"];

const names = [
  "线性模型基本形式", "线性回归", "最小二乘法", "多元线性回归", "正则化",
  "对数线性回归", "广义线性模型", "对数几率函数", "对数几率回归", "对数几率回归的极大似然估计",
  "线性判别分析（LDA）", "类内与类间散度矩阵", "多分类 LDA 与监督降维", "多分类学习与拆解法",
  "一对一（OvO）与一对其余（OvR）", "纠错输出码（ECOC）", "类别不平衡", "再缩放",
  "欠采样、过采样与阈值移动", "代价敏感学习",
];
// Test dependency lists: current concept -> required concept. Five branches,
// a shared dependency and one intentionally disconnected component.
const dependencies = [[], [0], [1], [1, 2], [3], [1], [5], [0], [7], [8], [0], [10], [11], [0], [13], [14], [], [16], [17], [16]];
const makeConcept = (id, name, links, index = 0) => ({
  id, name, links, x: 0, y: 0, group: 0,
  description: `【布局验收示例】${name}。名称用于检查长中文与缩写的排版；连接关系为手工示例，不是教材结论。${index === 0 ? "\n\n选择此节点检查详情，再返回图谱。引用只能进入右侧测试草稿，不应自动发送。" : ""}`,
  anchors: [{ sourceId: "qa-layout-textbook", title: "布局验收示例教材", page: 69 + Math.floor(index / 3), quote: "验收专用示例来源，不对应用户 PDF 原文。" }],
});
const chapter = names.map((name, index) => makeConcept(`chapter-${index}`, name, dependencies[index].map((id) => `chapter-${id}`), index));
const cycle = [
  makeConcept("cycle-0", "基础定义", []),
  makeConcept("cycle-1", "模型假设", ["cycle-0", "cycle-3"]),
  makeConcept("cycle-2", "参数估计", ["cycle-1"]),
  makeConcept("cycle-3", "验证与反馈", ["cycle-2"]),
  makeConcept("cycle-4", "实验设计与可重复性", ["cycle-0"]),
  makeConcept("cycle-5", "扩展方法", ["cycle-3", "cycle-4"]),
  makeConcept("cycle-6", "独立概念", []),
];
const disconnected = Array.from({ length: 15 }, (_, index) => {
  const family = Math.floor(index / 4), position = index % 4;
  return makeConcept(`island-${index}`, position === 0 ? `第 ${family + 1} 组起点` : `${["", "基本机制", "理解与推导", "扩展应用"][position]} ${family + 1}`,
    position && index < 12 ? [`island-${index - 1}`] : [], index);
});
const hundred = Array.from({ length: 100 }, (_, index) => {
  const branch = Math.floor((index - 1) / 11);
  const base = 1 + branch * 11;
  const links = index === 0 ? [] : index === base ? ["many-0"] : [`many-${index - 1}`];
  if (index > 20 && index % 7 === 0) links.push(`many-${index - 13}`);
  return makeConcept(`many-${index}`, index === 0 ? "学习主题与共同基础" : `${names[index % names.length]} · 示例 ${index}`, links, index);
});

const fixtures = {
  chapter: { title: "20 个长中文概念", description: "第三章同名概念、手工示例关系。验证核心展开、共享依赖、两块独立知识。", relationKind: "prerequisite", concepts: chapter,
    checks: ["每个名称紧邻自己的点，缩放时一起移动", "核心与扩展结构可辨认，不把独立概念强连起来", "可搜索、解释、引用任何概念"] },
  cycle: { title: "循环与共享依赖", description: "7 个示例节点，其中 3 个形成循环；两路依赖汇合。", relationKind: "prerequisite", concepts: cycle,
    checks: ["循环不会令布局或展开陷入死循环", "不伪称循环节点有唯一先修顺序", "每个节点只出现一次，真实边仍可查看"] },
  disconnected: { title: "多根与独立概念", description: "3 条独立链与 3 个孤立概念，共 15 节点。", relationKind: "related", concepts: disconnected,
    checks: ["独立组保持分离，不为画面连通制造关系", "纯关联图不标成先修图", "切换起点不会令其他组消失"] },
  hundred: { title: "100 个概念", description: "9 条扩展分支与跨分支关联；所有关系都是压力测试数据。", relationKind: "prerequisite", concepts: hundred,
    checks: ["总览仍能辨认结构，放大后能读到局部标签", "渐进展开可以到达全部 100 个节点", "切换、搜索与缩放不明显阻塞操作"] },
  "far-pin": { title: "旧的极远固定点", description: "20 概念中一项固定在 (6000, 0)。用于重现旧布局被拉到 15% 的风险。", relationKind: "prerequisite",
    concepts: chapter.map((concept, index) => index === 18 ? { ...concept, layout: { x: 6000, y: 0 } } : concept),
    checks: ["自动结构布局可读，不受旧固定点拖远", "切换布局不能删除用户的旧固定位置", "关联布局可恢复或重置手动位置"] },
};

export function graphFixture(id = "chapter") {
  const key = GRAPH_FIXTURE_IDS.includes(id) ? id : "chapter";
  return structuredClone({ id: key, ...fixtures[key] });
}

export const graphFixtureChoices = GRAPH_FIXTURE_IDS.map((id) => ({ id, title: fixtures[id].title }));
