# 本机数据、文件与依赖边界

SideReader 的项目导航是学习内容的视图，不是硬盘目录。资料、对话、学习对象及其关系保存在项目记录中；打开对象、并排或浮动查看不复制 PDF，不创建新的硬盘文件，也不改变对象归属。

## 存储职责

| 数据 | 唯一入口 | 位置与生命周期 |
| --- | --- | --- |
| 项目内容与关系、阅读位置、书签、概念、关卡、练习、对话 | `src/persistence/project-repository.ts` | 当前站点的 IndexedDB，跨刷新保留 |
| 导入的 PDF 原文件 | 同一 repository 的 `readPdf/savePdf/removePdf` | IndexedDB，按资料 `sourceId` 寻址，与项目 JSON 分开 |
| 导航展开、每项目主视觉与并排位置、旁栏 PDF 页码、双栏比例等偏好 | `localPreferences` | localStorage，失败时保留当前界面，不影响内容读取 |
| 未发送文本与概念引用 | `createPreferences` 的 sessionStorage 适配器 | 按项目/对话会话键保存；页面布局切换保留，浏览器会话结束后可消失 |
| 当前请求、取消控制器、视口图像 | `tutor-sessions.mjs` | 内存，不写入项目或浏览器存储 |
| 模型连接配置与密钥 | 服务端 `providers.mjs` | `.local/config.json`；不写入浏览器项目记录 |

浏览器站点数据按 origin 隔离。`http://127.0.0.1:5173` 和 `http://127.0.0.1:3001` 的项目库不同；清理其中一个站点的数据不是“关闭项目”，会移除该站点的学习记录和导入文件。

## 原文件与服务端初始资料

`.local/books/manifest.json` 将资料 ID 映射到 `.local/books/` 内的 PDF 文件。`/api/books/:id` 只按该清单读取已登记文件，不将 UI 中的标题或章节名当作磁盘路径。浏览器导入的 PDF 保存在 IndexedDB，不自动上传到这个目录。

`src/services/source-files.ts` 先读取 IndexedDB；只有缺少对应 PDF 时才请求本机 `/api/books/:id` 并缓存返回的原文件。此步骤保留资料 ID，不创建第二个资料对象。保存书签只是记录资料 ID、页码和摘录，不复制原书。

`.local/bootstrap.json` 只为没有浏览器项目和旧版工作区的新环境提供初始项目。后续编辑以浏览器 IndexedDB 为准，不会写回 bootstrap，也不能通过修改 bootstrap 覆盖已有学习数据。

## 兼容和错误处理

- `src/persistence/keys.mjs` 是所有浏览器存储键和数据版本的唯一声明处。模块或 UI 改名不修改存储地址；工作区 v1、项目 v2、原有 PDF、偏好与草稿键都保持原值。
- `src/project-loading.mjs` 按已有项目、旧版工作区、初始数据、内置种子的顺序加载。未知持久化格式或读取失败必须报错，不能降级成一个可写的空项目覆盖原数据。
- 项目和 PDF 的读写错误向上抛出；可选偏好和草稿写入失败返回 `false`，内存中的内容继续可用。读取损坏偏好返回调用方默认值，不主动删除原记录。
- `src/storage.ts` 仅保留旧调用者的兼容导出。当前组件明确依赖持久化仓库或 HTTP 服务，后续不得把 HTTP 请求重新塞入数据库模块。

## 网络与依赖

`src/services/http.ts` 负责 JSON 请求，`tutor.ts` 负责 Tutor 请求，`tutor-stream.mjs` 负责逐行流解码；React 组件负责交互与呈现。纯领域规则不依赖组件、React、浏览器存储或网络服务，服务端可复用这些规则。

`package.json` 与 `package-lock.json` 一起声明直接依赖。原先通过传递依赖获取但已被代码直接引用的 KaTeX 样式和 esbuild 测试编译器，现在声明为现有安装版本；没有升级运行库或增加替代框架。

运行 `npm run check:architecture` 可检查领域与基础设施边界、浏览器存储/HTTP 唯一入口、未声明的直接依赖，以及清单和锁文件的一致性。根目录下既有的纯 `.mjs` 规则仍是合法领域模块，不要求仅为整理路径改动全部调用方；`tutor-sessions.mjs` 是显式的有状态会话运行模块。
