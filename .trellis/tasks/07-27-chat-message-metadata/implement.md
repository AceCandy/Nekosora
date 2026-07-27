# 聊天回复运行元数据：执行计划

## 成功标准

实现 `prd.md` 的 AC1-AC9；实际运行元数据在实时、刷新、版本切换和续写路径中保持同一来源与同一语义，公开分享边界不变。

## 执行清单

### 1. 重新确认工作树与规范

- [ ] 重新读取 `git status`、当前任务状态和即将修改的文件，确认分享弹窗任务留下的改动。
- [ ] 加载 `trellis-before-dev`，按 frontend/backend index 读取本任务关联规范。
- [ ] 用 CodeGraph 复核 `POST -> finalizeRun -> SSE -> store -> ChatMessageItem` 与 `getVisibleBranch/getMessageSiblings` 最新调用链。

验证：没有覆盖或格式化无关改动；每个预计改动文件都能追溯到需求 ID。

### 2. 先写数据库与 lifecycle 测试

- [ ] 扩展 schema/迁移测试，断言 `runs.duration_ms` 和 `runs.completed_at` 均为 nullable，完成时间为 timestamptz。
- [ ] 扩展 `run-lifecycle.test.ts`，先覆盖 finalize 同时写 status、tokenUsage、durationMs、completedAt，且只更新 running run。
- [ ] 修改 schema 和 `FinalizeRunParams`，让测试通过。
- [ ] 运行 `pnpm db:generate:pg` 追加迁移，检查 SQL、journal、snapshot；禁止改写 0000-0016。

验证：定向 schema/lifecycle/迁移测试通过；`git diff -- drizzle/pg` 只出现新迁移、journal 追加和新 snapshot。

回滚点：可整体撤回新增 nullable 列与 lifecycle 参数，不影响既有消息数据。

### 3. 建立单一 metadata 契约

- [ ] 在 chat model 层定义 `MessageRunMetadata`，复用现有 `TokenUsage`，并给 `ChatMessage` 增加可选 `runMetadata`。
- [ ] 为 DTO 边界增加字段缺失、真实零值和 ISO 时间测试；避免在 SSE、branch、UI 各写一份类型。

验证：类型检查能阻止 raw IRUsage 或数据库 Date 直接进入 Client Component。

### 4. 打通历史与版本切换投影

- [ ] 先在 `branch.test.ts` 增加失败用例：批量 run 查询必须限定 conversation，主线和 sibling 都回填正确 metadata，缺失字段安全降级。
- [ ] 实现共享的按 runIds 批量 loader，接入 `getVisibleBranch` 和 `getMessageSiblings`，避免 N+1。
- [ ] 更新页面初始消息映射和 `switchVersion` store 映射，确保 `completedAt` 为 ISO 字符串，切换时不残留前一版本 metadata。

验证：branch 与 store 版本切换测试通过；跨会话 run 不进入结果。

### 5. 打通实时 finish 数据流

- [ ] 先扩展 `sse.test.ts`、`chatStreamStore.test.ts` 和 `/api/chat` route 测试，覆盖 finish metadata、事件顺序、四条生成路径和失败路径。
- [ ] `/api/chat` 入口记录整轮起点；assistant 必要持久化完成后只计算一次 duration/completedAt，并传给 `finalizeRun`。
- [ ] 把面向 WebChat 的 finish metadata 放到必要持久化和 finalize 尝试之后、`[DONE]` 之前；持久化失败不得发送成功 finish。
- [ ] `consumeChatSSE` 增加 typed `finish` 分支；store 对普通发送、重新生成、编辑重发和续写覆盖当前 assistant metadata，并在新一轮开始时清掉旧值。
- [ ] 同时移除面向普通客户端的 trace SSE、SSE trace handler 和 store trace merge；服务端仍把同一 trace 写入 assistant `processTrace`。

验证：route 测试明确断言 `assistant persistence -> finalize attempt -> finish metadata -> [DONE]`，且普通客户端不再收到 trace 帧；四条 store 路径均无需刷新即可得到正确值。

回滚点：finish payload 和 handler 可以独立撤回，不改变模型流文本协议或历史数据。

### 6. 实现回复底部交互并移除旧追踪面板

- [ ] 为 `ChatMessageItem` 增加 metadata 展示测试：字段顺序、缺失隐藏、零值保留、长模型名、可访问标签、触屏展开入口。
- [ ] 在现有 assistant 工具区加入稳定几何的 metadata 行：桌面 hover/focus 淡入，移动端信息按钮展开；不创建卡片、不改分享只读组件。
- [ ] 使用 Lucide 图标、语义字号、品牌中性色、`formatDuration`/`formatDateTimeLocal` 和 locale 数字格式。
- [ ] 从 `ChatMessageItem` 删除旧追踪折叠面板，并移除 `ChatMessage.trace`、历史 trace 映射及对应中英文 i18n key；不得删除服务端 `ProcessTrace` 构建或持久化。

验证：组件测试与 i18n 检查通过；普通 ChatMessage/UI 无 trace 字段或面板；静态扫描无裸 hex、任意字号、`transition-all` 或仅 hover 可访问的触屏内容。

### 7. 全量质量门与独立复核

- [ ] 运行定向测试：schema/migration、run lifecycle、route、SSE、store、branch、message component、readonly share。
- [ ] 运行 `pnpm check` 和 `pnpm test`；本项目为 TypeScript，不涉及 Java 全量编译限制。
- [ ] 临时启动应用并用浏览器验证 320/390/768/1280px、亮/暗主题、hover、Tab focus、coarse pointer，截图并比较显隐前后布局矩形。
- [ ] 调试完成后关闭本次启动的服务并清理截图/临时产物。
- [ ] 派独立只读复核，检查需求覆盖、跨层字段、授权、迁移三件套、历史降级、分享边界和用户已有改动。

验证：AC1-AC9 全部有代码、测试或浏览器证据；没有未说明的失败检查和临时文件。

## 重点风险文件

- `src/app/api/chat/route.ts`：完成/失败时序和 `[DONE]` 正确性。
- `src/lib/chat/run-lifecycle.ts`：run 活动租约与 best-effort 终态语义。
- `src/features/chat/actions/branch.ts`：conversation 授权、版本投影和 N+1 风险。
- `src/features/chat/store/chatStreamStore.ts`：四条流式路径和版本残留。
- `src/features/chat/components/ChatMessageItem.tsx`：现有反馈/重生成菜单与响应式布局。
- `messages/en.json`、`messages/zh-CN.json`：可能与当前分享弹窗任务重叠，修改前必须读取当前磁盘内容。
- `drizzle/pg/meta/**`：只允许生成追加，不得手改历史 entry。

## 不执行的操作

- 不改模型目录或路由算法。
- 不从 `usage_logs` 拼装消息元数据。
- 不填充 `messages.tokenUsage` 或复制 model 字段。
- 不修改公开分享 DTO/组件以携带 metadata。
- 不删除 `messages.processTrace`、`buildTrace` 或服务端 assistant trace 持久化。
- 不展示 provider、upstream model、route、Key、TTFT、费用或计算型总 Token。
- 不回填历史 duration/completedAt。
