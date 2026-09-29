import type { Source, Workspace, Chunk } from "./types";
export function makeChunks(
  sourceId: string,
  title: string,
  pages: string[],
  paths?: string[],
): Chunk[] {
  return pages.flatMap((text, p) => {
    const chunks: Chunk[] = [];
    for (let offset = 0; offset < text.length; offset += 700) {
      chunks.push({
        id: `${sourceId}:${p + 1}:${offset}`,
        sourceId,
        title,
        page: p + 1,
        text: text.slice(offset, offset + 900),
        ...(paths ? { path: paths[p] } : {}),
      });
      if (offset + 900 >= text.length) break;
    }
    return chunks;
  });
}
const guidePages = [
  `# 从语言模型到智能体\n\n## 01  重新理解 Agent\n\n大语言模型擅长根据上下文生成文字，而智能体（Agent）把这种能力放进一个能够观察、决策和行动的循环中。它不仅回答问题，还能通过工具与外部世界交互，并根据执行结果调整下一步行动。\n\n一个实用的智能体通常由四个部分组成：模型、工具、记忆和控制循环。模型负责理解与推理，工具提供可执行的能力，记忆保存必要的上下文，而控制循环负责把这些部分连接起来。\n\n> Agent = 模型 + 工具 + 记忆 + 控制循环\n\n## 从一次回答，到一个过程\n\n传统问答通常是输入到输出的单次映射。Agent 则将任务分解成可观察的步骤：接收目标、理解环境、选择工具、读取结果，再决定继续行动还是给出回答。\n\n例如，要回答“这个仓库如何实现持久化”，学习助手可以先查阅目录，再定位相关文件，阅读实现，最后用文件路径与代码证据解释机制。这比只根据模型记忆生成答案更可靠。\n\n## 什么时候需要智能体？\n\n当任务路径无法预先确定、需要根据中间结果作判断时，智能体更有价值。如果步骤稳定而明确，确定性的代码或工作流通常更简单，也更容易验证。`,
  `# 工具调用与控制循环\n\n## 02  让模型拥有行动能力\n\n工具是模型与外部环境交互的接口。一个好的工具应具有明确的名称、清晰的输入参数、可预测的输出，以及可理解的失败信息。\n\n在 ReAct 模式中，模型交替进行推理（Reasoning）和行动（Acting）。每次行动产生新的观察结果，观察又成为下一轮推理的依据。\n\n## 一个最小控制循环\n\n1. 将用户目标和可用工具交给模型。\n2. 模型选择调用工具，或直接给出答案。\n3. 执行被选择的工具，记录结果。\n4. 将结果加入上下文，继续决策。\n5. 达到停止条件后返回答案。\n\n控制循环必须设置最大步骤数、超时和错误处理，避免无限运行。对于会修改外部状态的工具，还需要明确的权限边界。\n\n## 工具设计的关键\n\n工具描述决定模型何时使用工具。返回结果应包含完成判断所需的信息，避免把冗长无关的日志放入上下文。错误结果应指导恢复，而不是只返回“失败”。`,
  `# 让回答有据可依\n\n## 03  检索增强生成 RAG\n\n检索增强生成（Retrieval-Augmented Generation）让模型在回答前先获取外部知识。基本流程包括文档解析、文本分块、建立索引、检索相关片段，以及根据片段生成带引用的回答。\n\n## 分块：在完整与精确之间\n\n文本块过小会丢失上下文，过大则引入无关信息。可以根据标题、段落和页面构建结构化分块，并保留文档标识、页码、段落位置等元数据。少量重叠有助于保留跨块语义。\n\n## 多路检索\n\n关键词检索擅长准确匹配术语、函数名与专有名词。语义检索有助于发现不同措辞表达的相近概念。当前页面和用户选中文本则提供了阅读场景中的局部上下文。\n\n多个召回列表可以通过 Reciprocal Rank Fusion（RRF）融合。RRF 根据文档在各个列表中的排名累加得分，避免直接比较不同检索器不可比的原始分数。\n\n## Agentic RAG\n\n智能体可以主动规划查询、检查已有证据是否充分，并在必要时改写问题或继续检索。应把证据选择过程变得可观察，让用户能够回到原文验证。`,
  `# 上下文与记忆\n\n## 04  把正确的信息放在正确的位置\n\n上下文窗口有限，不能把全部文档和历史记录都直接交给模型。上下文工程关心的是：当前决策真正需要哪些信息，以及怎样组织它们。\n\n短期记忆记录当前会话中的目标、最近的观察和未完成事项。长期记忆则保存跨会话有价值的信息，例如学习目标、已掌握的概念和容易混淆的知识点。\n\n## 保留来源与边界\n\n压缩历史时，需要保留关键约束、已确认的结论和证据位置。模型推断应与用户明确提供的事实区分开，避免把一次猜测固化为长期记忆。\n\n知识图谱可以连接概念和先修关系；个性化关卡则将学习目标变成可验证的任务。它们是可维护的学习对象，而不应该只是一次性生成的装饰。`,
];
function demoSource(
  id: string,
  title: string,
  author: string,
  kind: Source["kind"],
  pages: string[],
  color: string,
  description: string,
  progress = 0,
): Source {
  return {
    id,
    title,
    author,
    kind,
    pages,
    chunks: makeChunks(id, title, pages),
    color,
    description,
    progress,
    added: "2026-09-22",
    demo: true,
  };
}
export const initialWorkspace: Workspace = {
  version: 1,
  name: "Agent 工程",
  goal: "理解 Agent 的核心机制，独立构建一个有记忆、会使用工具的学习助手。",
  activeSource: "guide",
  page: 1,
  sources: [
    demoSource(
      "guide",
      "Agent 工程入门",
      "SideReader · 示例读本",
      "note",
      guidePages,
      "sage",
      "从模型、工具到记忆，建立智能体工程的完整认知。",
      1,
    ),
    demoSource(
      "rag",
      "RAG 实践手册",
      "SideReader · 示例笔记",
      "note",
      [
        guidePages[2],
        "# 检索系统的评估\n\n检索质量可以从召回率和排序质量两个方面观察。先建立包含真实问题与相关文档的评估集，再比较不同分块策略与召回方案。\n\n回答质量还取决于引用准确性、证据覆盖率和模型是否承认不确定性。单独提升召回数量并不能保证更好的答案。",
      ],
      "sand",
      "把知识接入模型，让每个回答都有迹可循。",
    ),
    demoSource(
      "patterns",
      "Agent 设计模式",
      "SideReader · 示例笔记",
      "note",
      [guidePages[1], guidePages[3]],
      "blue",
      "理解控制循环、工具边界与上下文组织。",
    ),
  ],
  concepts: [
    {
      id: "agent",
      name: "Agent",
      description: "观察、决策与行动的循环，是这个领域的核心概念。",
      x: 49,
      y: 47,
      group: 0,
      links: ["llm", "tools", "memory", "rag", "eval"],
    },
    {
      id: "llm",
      name: "语言模型",
      description: "根据上下文理解问题、推理并生成回答。",
      x: 26,
      y: 23,
      group: 1,
      links: ["context"],
    },
    {
      id: "tools",
      name: "工具调用",
      description: "通过明确的接口获得信息或执行操作。",
      x: 74,
      y: 25,
      group: 0,
      links: ["react"],
    },
    {
      id: "memory",
      name: "记忆",
      description: "保存当前任务状态与跨会话的有效知识。",
      x: 23,
      y: 65,
      group: 1,
      links: ["context"],
    },
    {
      id: "rag",
      name: "RAG",
      description: "在生成答案前检索外部知识，并保留来源引用。",
      x: 72,
      y: 69,
      group: 2,
      links: ["retrieval"],
    },
    {
      id: "context",
      name: "上下文工程",
      description: "选择并组织当前决策所需的信息。",
      x: 11,
      y: 42,
      group: 1,
      links: [],
    },
    {
      id: "react",
      name: "ReAct",
      description: "交替进行推理和行动，根据观察结果调整下一步。",
      x: 89,
      y: 44,
      group: 0,
      links: [],
    },
    {
      id: "eval",
      name: "评估",
      description: "用可重复的任务与指标验证系统行为。",
      x: 43,
      y: 85,
      group: 2,
      links: [],
    },
    {
      id: "retrieval",
      name: "检索策略",
      description: "结合关键词、查询扩展与场景信息召回证据。",
      x: 89,
      y: 86,
      group: 2,
      links: [],
    },
  ],
  stages: [
    {
      id: "s1",
      title: "建立 Agent 的全局认知",
      description:
        "阅读示例读本第 1 章，能用自己的话解释 Agent 的四个组成部分。",
      done: true,
      tag: "基础认知",
    },
    {
      id: "s2",
      title: "理解工具调用与控制循环",
      description: "阅读第 2 章，画出一次工具调用从决策到观察的完整路径。",
      done: false,
      tag: "正在学习",
    },
    {
      id: "s3",
      title: "搭建有据可依的 RAG",
      description: "导入一份学习材料，比较不同问题的召回结果，验证每一个引用。",
      done: false,
      tag: "动手实践",
    },
    {
      id: "s4",
      title: "给你的 Agent 加上记忆",
      description: "区分短期状态与长期记忆，为一个具体任务设计上下文。",
      done: false,
      tag: "能力进阶",
    },
    {
      id: "s5",
      title: "完成你的第一个学习助手",
      description: "连接模型、准备知识来源，并用真实问题验证整个流程。",
      done: false,
      tag: "毕业项目",
    },
  ],
  sets: [
    {
      id: "q1",
      title: "Agent 基础 · 理解与自测",
      description: "用几个小问题，确认你真的理解了。",
      questions: [
        {
          id: "qa",
          type: "choice",
          prompt: "以下哪一项最准确地描述了 Agent 与普通语言模型问答的区别？",
          options: [
            "Agent 的参数量一定更大",
            "Agent 可以在观察、决策与行动的循环中使用工具",
            "Agent 不需要语言模型",
            "Agent 总能一次给出正确答案",
          ],
          answer: "1",
          explanation:
            "Agent 将模型置于控制循环中，通过工具行动、观察结果，并据此调整后续决策。",
        },
        {
          id: "qb",
          type: "boolean",
          prompt: "在 RAG 系统中，增加召回文本块的数量一定会提升回答质量。",
          options: ["正确", "错误"],
          answer: "1",
          explanation:
            "过多无关片段会增加噪声，挤占上下文。应关注相关性、覆盖率与排序质量。",
        },
        {
          id: "qc",
          type: "short",
          prompt: "请简述一个最小 Agent 控制循环的主要步骤。",
          options: [],
          answer: "接收目标；模型决策；调用工具；观察结果；继续决策或停止。",
          explanation:
            "重点是行动结果会反馈给下一轮决策，而不是一次性的输入与输出。",
        },
      ],
    },
  ],
};
