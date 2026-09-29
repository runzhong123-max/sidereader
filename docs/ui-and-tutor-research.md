# UI 与计算机辅导设计调研

调研日期：2026-09-22。以下为一手资料和开源项目的公开设计，不把第三方流传的隐藏 system prompt 当作事实。外部 skill 作为研究对象阅读，没有安装或执行其中脚本。

## AI 做 UI 的常见错误，以及本项目的取舍

1. **把默认模板当设计。** Anthropic 的 frontend-design skill 指出重复卡片、装饰性标签、统一圆角阴影和无目的动效容易盖过内容。SideReader 是阅读工具，保留项目/标签布局，删去 tutor 星芒欢迎图、装饰性眉题和卡片式提问入口，改成简洁列表。
2. **把轻量理解成低对比、小字号。** 原侧栏和回答存在8–12px淡绿色文字。正文改为15px中性深色，元信息提高到11–12px；系统字体替代外部字体下载。WCAG普通文本要求至少4.5:1对比度，目标尺寸最小24 CSS px有例外条件；这里将主要小按钮做到30px左右，内嵌引用24px。不声称整个应用通过完整WCAG审计。
3. **只优化截图，不考虑真实内容。** 代码、公式、长URL、表格会撑破窄侧栏。改为专用渲染与容器内横向滚动，来源内联跳转，详细证据与检索信息渐进展开。
4. **忽略操作与失败状态。** Vercel指南强调语义控件、焦点、异步反馈与减少动画。增加输入框整体焦点、清空对话确认、失败重试、可见状态说明；用户上滚阅读时不强制跟随新消息。
5. **一味追求“与众不同”。** Impeccable区分操作/阅读与营销场景。本项目采用系统字体、稳定对齐、克制绿色，未照搬其大胆视觉探索建议。用户的苹果风格与长期阅读优先。

来源：
- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
- [Impeccable 源 skill](https://github.com/pbakaus/impeccable/blob/main/skill/SKILL.src.md)
- [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md)
- [WCAG 2.2 文本对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## 回答怎样同时有逻辑、启发性和教育性

OpenAI Study Mode公开说明强调分步支架、主动参与、认知负荷和理解检查。Google LearnLM公开框架也将教学行为与系统指令相连。这些产品的效果不能直接推断为本应用的效果，但可作为设计依据。

Claude Code公开的learning-output-style将少量有意义的编程实践与解释结合，避免让用户做无价值样板工作。我们采用“小输入追踪、关键步骤预测、5–10行有意义实现”的思想，不复制其装饰性Insight框，也不强迫用户完成每个步骤后才能看答案。

本项目落地：
- **讲解**：直接回应→机制→最小例子→必要的边界。简单问题可以两三句，不机械填满模板。
- **引导**：依据已有尝试给一个有用提示，邀请完成一步；卡住就降低难度，明确要求答案时直接讲解。
- **自测**：一次一道迁移题，先等待作答，再定位具体错误并反馈，不在出题时泄露答案。
- **概念流程**：解决的问题、定义、最小例子、一个反例或边界。
- **数学流程**：前提、符号和维度、可检验的推导、小数值验证；不把OCR错误当成公式。
- **编码流程**：期望/实际行为、可证伪假设、最小修复、预期结果和边界输入；没有执行器就不声称测试通过。
- **项目流程**：目标、先修依赖、3–5个可验收阶段及立即可做的动作；区分完成记录和真正掌握。

来源：
- [OpenAI Study Mode 公开设计](https://openai.com/index/chatgpt-study-mode/)
- [Google LearnLM 与教学框架](https://cloud.google.com/solutions/learnlm)
- [Claude Code learning-output-style 公开上下文](https://github.com/anthropics/claude-code/blob/main/plugins/learning-output-style/hooks-handlers/session-start.sh)

## 上下文与渲染契约

稳定教学前缀 → 按任务选择的静态流程 → 首次用户目标及最近对话 → 本轮结构化数据。

本轮数据包含目标、辅导方式、选区、可见区域、来源页码、可选页图、已维护概念/关卡、最多6个证据。动态材料不进入system。长内容显式标注省略，历史角色仅允许user/assistant，历史引用编号不能沿用。流程通过关键词启发式路由，未声称是模型分类器或自适应掌握模型。

回答是Markdown契约：带语言代码块；$行内公式$与$$独立公式$$；[1]式证据标记。引用转换发生在语法树普通文本节点，不改写代码、数学表达式或已有链接。渲染不接受原始HTML、不执行代码、不加载模型提供的远程图片。KaTeX关闭trust并限制宏展开。编号存在只证明来源可定位，不自动证明主张受来源支持。

实现：server/prompts/、server/tutor-context.mjs、src/components/AnswerMarkdown.tsx。支持库：[react-markdown](https://github.com/remarkjs/react-markdown)、[remark-math](https://github.com/remarkjs/remark-math)、[rehype-highlight](https://github.com/rehypejs/rehype-highlight)。

验证分开：结构和边界由自动测试验证；学习体验以场景样本人工检查；真正学习收益还需要用户学习表现，不能由提示词或截图宣称已经提升。
