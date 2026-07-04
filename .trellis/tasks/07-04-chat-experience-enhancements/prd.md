# Chat 体验增强批次

## Goal

基于 4 个开源参考项目（AMC-WebUI / AQBot / DEEIX-Chat / kivio）的对比调研，对当前 chat 界面分批补齐 12 项体验增强功能。父任务持有需求集与跨子任务验收标准，本身不直接实现，最终负责集成 review 与回归确认。

本批次共 12 项功能（原调研 13 项中「打字机效果」与 SSE 流式概念重叠，暂缓不做），拆为 9 个子任务：

| 子任务 | 包含功能 | Wave |
|---|---|---|
| chat-misc-ui | Markdown 错误边界 + 输入框 token 计数 + 欢迎屏 | A |
| chat-tts | TTS 朗读（浏览器原生） | A |
| chat-message-branch-ops | 单条消息删除 + 继续生成 | A |
| chat-model-params | 模型参数调节（temp/topP/maxTokens） | B |
| chat-slash-commands | 斜杠命令（输入框内解析） | B |
| chat-regenerate-switch-model | 重生成切换模型（轻量版） | B |
| chat-selection-toolbar | 文本选中浮工具栏 | B |
| chat-fulltext-search | 侧栏全文搜索 | C |
| chat-virtual-scroll | 消息虚拟滚动 | C |

## Requirements

- 12 项功能按子任务独立交付，每个子任务可独立验证、独立回滚
- 不破坏现有 chat 核心链路：流式 SSE、分支版本、工具调用、思考过程、Artifact、上下文追踪
- 复用现有基础设施：`chatStreamStore`、`branch.ts`、`composerState`、`useChatScrollController`、指令卡体系、streamdown 渲染
- 多模型并排仅做轻量版（重生成换模型），不重构 store 多 runtime
- 涉及后端的子任务（model-params / branch-ops 的 continue / fulltext-search）前后端联动

## Acceptance Criteria

- [ ] 9 个子任务全部完成并归档
- [ ] 12 项功能在 chat 界面均可操作且符合各自子任务验收标准
- [ ] 现有核心链路无回归：流式、分支版本、工具调用、思考、Artifact、附件、联网搜索、知识库
- [ ] 集成 review 通过：子任务间无冲突（特别是 virtual-scroll 对 selection-toolbar / welcome-screen 的连带适配）
- [ ] 移动端基本可用（侧栏抽屉、输入框断点不破）

## Constraints

- 技术栈固定：Next.js 15 App Router / React 19 / Tailwind v4 / Zustand / streamdown / Drizzle / Vercel AI SDK v5 / next-intl
- 所有新增前端文案走 `useTranslations("chat")` i18n
- 暗色模式复用现有 `.dark` class 策略，新组件必须带 `dark:` 样式
- 不引入重的桌面专属能力（全局热键、托盘、本地 Pyodide、API 网关）

## Notes

- 子任务依赖：B 组 `chat-regenerate-switch-model` 依赖 A 组 `chat-message-branch-ops` 的分支基础；C 组 `chat-virtual-scroll` 必须最后做，做完回头适配 selection-toolbar 定位与 welcome-screen 空状态
- 架构级子任务（`chat-message-branch-ops` / `chat-fulltext-search` / `chat-virtual-scroll` / `chat-model-params`）须补 `design.md` + `implement.md` 后才能 `task.py start`
- 参考项目源码位于 `docs/cankao/{AMC-WebUI,AQBot,DEEIX-Chat,kivio}`
