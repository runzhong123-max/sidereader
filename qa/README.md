# Safari 开发验收页

本地服务启动后，仅在 Safari 打开：

http://127.0.0.1:5173/qa/ui-check.html

页面直接导入生产 `Questions`、`LearningObjectCard`、`ReferenceSnapshot`、`EvidenceCitation`、`ConversationGraphCard` 与 `Graph`，未复制它们的实现。所有内容明确标注测试数据；作答、草稿、编辑和拖动位置只保存在该页 React 内存中。刷新或“重置测试”可清空。主题只调用 `applyTheme`，不会保存用户主题偏好。没有项目存储调用、模型请求或发送按钮。

生产入口不导入此页，默认 Vite 生产构建也不包含它。入口还有 `import.meta.env.DEV` 限制。

## 场景

- `?scene=single`：先选 b 提交，检查错误反馈和唯一“问问这题”；再做一次选 w。重置后跳过，答案与解析不得出现。
- `?scene=multiple`：三题真实练习文件。检查答错/重试、上一题/下一题、判断题跳过再返回、简答自评、更多菜单编辑/重练。切换场景再返回，内存草稿和题位仍保留。
- `?scene=missing`：没有答案的教材简答题。提交后仅“待核对”，不凭空判对，也无参考答案/自评分数。
- `?scene=references`：展开历史长概念和长题干快照；引用不得截断。来源编号先打开摘录预览，点“打开原文”才触发右侧来源记录。
- `?scene=graph`：对话图谱放在可滚动容器后段。点概念就地显示解释；返回恢复节点位置。明确引用按钮和节点拖动只把概念放进右侧测试引用区。
- `?scene=fullgraph`：620×500 CSS 像素容器里的完整图谱，20 个概念。检查标签、缩放、节点拖动固定、详情返回与跨区引用。

在任意 URL 追加 `&theme=dark`，或用页头切换，检查真实主题样式。页面来源回调只展示测试来源；不会打开用户 PDF。此页验证组件交互与渲染，不能替代产品主页面的对象专属对话路由、真实 PDF 返回、浮窗移动和持久化验收。

页面与生产配置独立的类型检查：

```sh
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --jsx react-jsx --allowJs qa/ui-check.tsx
```
