# Chat 杂项 UI 增强

合并三个独立、零依赖的小改，降低任务管理开销。

## Goal

补齐 chat 界面三个独立的体验缺口：Markdown 渲染容错、输入态 token 可见、空会话引导。

## Requirements

### 1. Markdown 错误边界（#9）
- 为消息内容渲染提供三级 ErrorBoundary：
  - Markdown 渲染边界（单条消息 Markdown 崩溃不影响兄弟消息）
  - ToolCall 渲染边界（单个工具调用卡片崩溃不影响整条消息）
  - 整条消息渲染边界（兜底）
- 崩溃时显示友好占位（「该内容渲染失败」+ 原始文本折叠查看），不连坐整个消息列表

### 2. 输入框 token 实时计数（#14）
- 输入框区域实时显示当前输入文本的 token 估算
- 计数包含已附加的附件 token（图片/文件）
- 复用现有 `tokenEstimator`，不引入新依赖
- 超出当前模型上下文阈值时给视觉提示（如变色）

### 3. 欢迎屏 / 空状态（#12）
- 空会话页（`/chat` 与新会话）展示欢迎屏，替代当前简单空状态
- 包含：简短引导文案 + 可点击的示例问题（点击直接填入输入框或直发）
- 示例问题可配置（不写死在前端，从后端/配置读取，design 阶段确定来源）
- 暗色模式适配

## Acceptance Criteria

- [ ] 故意构造一段会触发 Markdown 解析异常的内容，渲染时只显示占位而不崩整列
- [ ] 单个 ToolCall 渲染异常不影响同条消息其它 ToolCall 与正文
- [ ] 输入文本时 token 计数实时变化；附加图片后计数增加
- [ ] 新建空会话可见欢迎屏；点击示例问题能填入/发送
- [ ] 欢迎屏在暗色模式下可读

## Constraints

- 三项互相独立，可分 commit 但归在同一子任务
- ErrorBoundary 不吞掉真正的代码 bug（开发环境仍抛出便于调试，仅生产兜底）—— design 阶段确认策略
- token 计数不能阻塞输入（debounce 或 requestAnimationFrame）

## Notes

- 参考 kivio 的三级 ErrorBoundary（`MarkdownErrorBoundary` / `ToolCallErrorBoundary` / `ChatErrorBoundary`）
- 参考 AMC-WebUI `WelcomeScreen.tsx` 与 `hooks/token-count/`
- 本任务 PRD-only 即可，无需 design.md
