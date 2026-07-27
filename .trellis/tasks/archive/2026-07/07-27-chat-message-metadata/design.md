# 聊天回复运行元数据：技术设计

## 1. 设计目标

在不复制运行事实、不改变公开分享边界的前提下，把现有 run 审计数据投影为每条 assistant 消息的可选 UI 元数据，并补齐整轮耗时和完成时间；普通客户端不再接收或展示现有上下文 trace。

## 2. 核心决策

### 2.1 `runs` 是唯一运行事实源

- 继续使用 `messages.runId -> runs.runId` 关联，不启用当前未写入的 `messages.tokenUsage`。
- 模型读取 `runs.platformModelName`，实际用量读取 `runs.tokenUsage`。
- 在 `runs` 新增两个 nullable 字段：
  - `durationMs` / `duration_ms integer`：本轮端到端耗时；
  - `completedAt` / `completed_at timestamptz`：本轮完成时刻。
- 不增加 message 级 model/latency 列，不从 `usage_logs` 反查。`usage_logs` 是计费/运维日志，且故障转移、Agent 多轮时不等同于单条消息的稳定投影。

### 2.2 共享一个前后端 DTO

在 chat model 层定义可序列化 DTO，并让实时 SSE、历史分支查询、版本切换和 UI 共用：

```ts
interface MessageRunMetadata {
  model?: string;
  tokenUsage?: TokenUsage;
  durationMs?: number;
  completedAt?: string; // ISO 8601
}
```

`ChatMessage` 新增 `runMetadata?: MessageRunMetadata`。字段保持可选，既表达历史 `NULL`，也保留供应商未上报细分用量的区别。不得在 UI 或各调用方重新定义一套 raw payload cast。

### 2.3 耗时与完成时间一次计算、同时持久化和下发

- `/api/chat` 的 `POST` 入口记录本轮单调时钟起点；收尾阶段使用单调时钟差得到非负整数 `durationMs`。
- assistant 必要消息持久化完成时生成一次 `completedAt` 并计算 `durationMs`；同一组值随后传给 `finalizeRun` 和 SSE DTO，避免实时/历史格式漂移。
- `finalizeRun` 仍只更新 `status='running'` 的当前 run，并继续遵守现有 5 秒 best-effort 契约；新增字段与 status/tokenUsage 在同一次 update 中写入。
- 不以 reasoning 本地计时、单次 `usage_logs.latencyMs` 或浏览器网络计时替代整轮耗时。

### 2.4 `finish` 成为客户端运行元数据边界

- 模型生成器产出内部 `finish` 时只收集 `finalUsage`，不立即向 WebChat 客户端发送半成品元数据。
- assistant 必要持久化和 run 终结尝试完成后，在 `[DONE]` 前发送一次：

```json
{"type":"finish","metadata":{"model":"...","tokenUsage":{},"durationMs":1234,"completedAt":"..."}}
```

- `consumeChatSSE` 在一个中心分支解析 `finish` 并调用 `onFinish(metadata)`；store 把 metadata 合并到当前 assistant 占位消息。
- 持久化失败路径继续发送 error、禁止 `[DONE]`，也不发送可被误认为成功完成的 metadata。

## 3. 数据流

### 3.1 新生成回复

```text
POST /api/chat 起点
  -> startRun(platformModelName)
  -> context / routing / failover / tool loop / model stream
  -> IRUsage -> TokenUsage
  -> assistant message 写入或续写 CAS 更新(runId)
  -> 计算 durationMs / completedAt
  -> finalizeRun(status, tokenUsage, durationMs, completedAt)
  -> SSE finish(MessageRunMetadata)
  -> chatStreamStore 合并到目标 assistant
  -> ChatMessageItem hover/focus/touch 展示
  -> [DONE]
```

### 3.2 历史恢复与版本切换

```text
已授权 conversation
  -> getVisibleBranch / getMessageSiblings 收集 assistant runIds
  -> 单次批量查询 runs，强制 conversationId 条件
  -> Map<runId, MessageRunMetadata>
  -> 回填每条 assistant 的 runMetadata
  -> Server Component 把 Date 转 ISO 字符串
  -> ChatMessage / store / ChatMessageItem
```

历史加载和兄弟版本查询必须复用同一个 run metadata loader，避免刷新路径与版本切换路径漂移；不得逐消息查询形成 N+1。

## 4. 数据库与迁移

1. 修改 `src/db/schema/pg.ts` 的 `runs` 表，新增 nullable `integer("duration_ms")` 和 `timestamp("completed_at", { withTimezone: true })`。
2. 通过现有 Drizzle PG 流程追加迁移（预计 `0017_*`），同步：
   - `drizzle/pg/0017_*.sql`；
   - `drizzle/pg/meta/_journal.json`；
   - `drizzle/pg/meta/0017_snapshot.json`。
3. 不修改任何既有 SQL、journal entry 或 snapshot。
4. 不回填历史数据；旧行保持 `NULL`，避免把消息创建时间误当成续写完成时间。
5. 新字段不参与 run 活动谓词和租约索引，不改变 `runs.status + leaseExpiresAt` 的生成活动语义。

## 5. 历史查询与授权

- 在 `src/features/chat/actions/branch.ts` 增加按 runIds 批量加载 metadata 的内部 helper，查询同时要求：
  - `runs.conversationId === 已授权 conversationId`；
  - `runs.runId IN 当前消息 runIds`。
- `getVisibleBranch` 和 `getMessageSiblings` 都使用该 helper。
- 返回给 Client Component 前仅保留模型、TokenUsage、耗时、ISO 完成时间；不返回 provider、route、upstreamId、Key 或整个 run 行。
- 公开分享的 action、snapshot DTO 和 `ReadonlyChatMessage` 不接入该 loader。

## 6. Store 与分支行为

- `consumeChatSSE` 的 `finish` handler 是 live metadata 唯一入口。
- store 必须在以下路径把 finish metadata 写入正确 assistant：普通发送、重新生成、编辑重发、续写。
- 开始重新生成/编辑重发时，目标 assistant 的旧 `runMetadata` 与旧内容一起清除，防止流式期间短暂显示旧模型或旧 Token。
- 续写更新同一 assistant，但服务端会写入新 `runId`；finish 必须覆盖原 metadata。
- `switchVersion` 使用 sibling 返回的 metadata 整体替换，不能保留前一版本字段。

## 7. UI 设计

- 在 assistant 消息最外层使用稳定的 group 作用域；元数据位于现有回复底部工具区，不新建卡片或浮动 section。
- 精细指针：元数据区域保留稳定几何，默认透明，`group-hover` 与 `group-focus-within` 以 150-200ms `transition-opacity` 显示；不得使用 `transition-all`。
- 粗指针：显示 `Info` 图标按钮，通过原消息内的可访问展开结构显示同一组 metadata；按钮使用 `touch-target`，支持键盘和屏幕阅读器。
- 数值使用 `tabular-nums`；模型名可收缩并截断，完整值放在 `title`；Token 数字使用 locale number formatting。
- 耗时复用 `src/shared/lib/format.ts` 的 `formatDuration`；时间复用 `formatDateTimeLocal`，维持项目固定 `Asia/Shanghai`、精确到秒且 SSR/client 一致的契约。
- 使用 `text-ui-caption` 表示 Token/耗时，时间戳可用 `text-ui-micro`；颜色只用现有冷调中性色。
- Token 图标和顺序固定：模型、输入、缓存读取、思考、输出、耗时；时间戳另行弱化。缺失项不渲染，值为 `0` 时保留。

## 8. 上下文追踪的服务端保留边界

- 保留 `buildTrace`、`ProcessTrace` 类型、`messages.processTrace` 列，以及 assistant insert/continue update 的服务端持久化。
- 删除 `/api/chat` 面向普通聊天的 `{ type: "trace" }` SSE 帧。
- 删除 `SSEEvent.trace`、`SSEHandlers.onTrace`、store trace merge、`ChatMessage.trace`、历史页面的 `processTrace -> trace` 映射和 `ChatMessageItem` 折叠面板。
- 删除只被该面板使用的 `routeTrace`、`contextCount`、`tokensUsed` 中英文翻译项。
- 不新增替代入口；未来开发者上下文诊断必须重新定义清晰的预算、裁剪原因、来源聚合和权限边界。

## 9. 兼容、失败与回滚

- 所有新字段和 DTO 成员可选；旧服务/旧数据不会导致渲染错误。
- 上游缺 usage 或细分字段时只隐藏对应指标；`0` 与未知严格区分。
- `finalizeRun` 写入失败时沿用现有租约过期与审计降级；不得让 metadata DB 失败阻断已经成功持久化的回复。
- 回滚应用代码后，新数据库列不会影响旧版本；迁移不做破坏性 down 操作。
- 若需回滚 UI，可移除 DTO 投影和 finish handler，同时保留 nullable 数据库列，不需要数据修复。

## 10. 验证策略

- 单元/集成：schema、迁移元数据、run lifecycle、API SSE 时序、SSE decoder、store 四条生成路径、branch 历史/版本/授权、格式化与字段缺失，以及普通客户端不再接收 trace。
- 组件：有/无 metadata、真实零值、长模型名、触屏展开的可访问名称与状态。
- 浏览器：320/390/768/1280px，亮/暗主题，鼠标 hover、键盘 Tab、coarse pointer；检查布局矩形在显隐前后不变化。
- 分享：现有只读分享测试继续断言没有登录态运行元数据。

## 11. 已知取舍

- 普通用户只看到平台模型，实际供应商路由留在后台日志，避免泄露基础设施且不扩大任务。
- 当前 `ProcessTrace` 仅作为服务端历史诊断数据保留；不继续维护一条无消费者的客户端投影。
- 不回填历史 duration/completedAt，牺牲旧消息完整度以换取语义可靠性。
- 不把 run finalize 升级为强一致主流程门槛，保持现有高可用与降级策略。
