# P2-B 可恢复 SSE 与请求幂等

## Goal

为 WebChat 定义**可恢复 SSE**与**请求幂等**的工程契约与分阶段落地路径，使网络抖动/刷新后客户端能按序重放已产生事件并正确收敛终态；在后续阶段再把生产者与浏览器连接解耦，实现断线后模型继续生成。

本任务**只产出设计与实施文档**，不修改业务代码、schema、migration。必须保留工作树中已有 P0/P1/P2-A 未提交改动。

## Current Reality（基于真实代码）

1. **`POST /api/chat`**（`src/app/api/chat/route.ts`）在单个 `ReadableStream` 内直接 `for await` 调用 `streamChat` / `streamChatWithTools`；`req.signal` 与 `ReadableStream.cancel` 共用 `AbortController`，客户端断开会 **abort 上游**；`finally` 持久化 assistant / 清 `generating` / `finalizeRun` 后才发 `data: [DONE]`。
2. **已有 run 骨架**：`runs` / `tool_calls` / `messages.runId`，以及本次 P1-A `run-lifecycle`（`createRunId` / `startRun` / `finalizeRun` / tool 记录 / `toSafeJsonb`）。`runs.status` 现为自由文本，终态为 `success | failed | interrupted`，运行中为 `running`。
3. **前端** `consumeChatSSE` + `chatStreamStore` **无** SSE `id:`、`Last-Event-ID`、重连、幂等键；仅解析 `data:` 行，收到 `[DONE]` 即 return。
4. **`conversations.generating` 为 boolean**；流开始置 `true`、finally 置 `false`；`bootstrap` 启动时会把残留 `generating=true` 清掉（进程崩溃侧栏转圈防护）。侧栏另有 `getGeneratingStatuses` 轮询。
5. **队列**：已有 pg-boss（`src/lib/infra/queue.ts` + `src/worker.ts`），当前用于 `conversation-title` / `memory-extract` / 文件处理等，**未**承载 chat 生成。

## Requirements

### R1 两阶段能力边界（禁止伪装）

必须在产品与 API 语义上**显式区分**：

| 阶段 | 能力 | 断线后模型是否继续 | 客户端能拿到什么 |
|------|------|-------------------|------------------|
| **A. 可重放 + interrupted 收敛** | 事件落库 + 重放 + 正确终态 | **否**（保持现有 abort 上游） | 已发出/已落库的部分事件；终态多为 `interrupted` 或已完成则 `success` |
| **B. 连接解耦后台生成** | 生产者独立于浏览器 SSE | **是** | 重连后按 `seq` 追上完整流直至 terminal |

- 阶段 A **不得**在 UI/文档/接口中宣称「后台继续生成」。
- 阶段 B 未完成前，不得把 A 的重连包装成 B。
- 灰度开关须能独立关闭 B；关闭后回落 A 语义。

### R2 事件契约

定义统一信封：`runId`、单调 `seq`、`eventId`、`type`、`payload`、`createdAt`。

- SSE 帧带 `id: <eventId>`；客户端用 `Last-Event-ID` 或查询参数 `after`（seq）重放。
- 同一 `runId` 内 `(runId, seq)` 唯一、严格递增；`eventId` 全局唯一（建议 `runId:seq`）。
- `data: [DONE]` 与 run terminal state 的关系必须写死：仅当 terminal 已落库且必要消息状态收敛后发送；重放路径可用 `type=done` 事件等价表达。

### R3 请求幂等

- 客户端为每次**用户意图**（send / retry / edit / continue）生成 `requestId` / `idempotencyKey`（UUID）。
- 作用域：`userId + conversationId + idempotencyKey`。
- 同 key + 同请求指纹：返回/附着既有 run，不重复插入 user/assistant/run。
- 同 key + 不同指纹：**409**。
- 无 key 的旧客户端保持现有「每次新建 run」行为（兼容）。

### R4 数据模型

- 建议 `run_events`（或等价表）+ `runs` 扩展字段 + 索引 + 保留期/清理。
- 不得无限制重复落完整敏感 prompt/response；必须有 payload 上限与脱敏（复用/扩展 `toSafeJsonb`）。
- 遵守 database guidelines：`getDb`/`getSchema`、动态 import 约束、Drizzle journal/snapshot 同提交。

### R5 状态机

状态集：`queued | preparing | streaming | waiting_tool | success | failed | interrupted`。

- 合法转换、崩溃恢复、超时、abort、工具调用等待。
- 多实例：阶段 B 需要租约/锁；阶段 A 可仅单请求占用。
- 与现有 `running` 的迁移映射必须明确。

### R6 API

- 创建/附着、事件重放、主动 stop、状态查询。
- 鉴权 + 会话属主隔离（对齐 `findConversationMessage` / conversation owner 模式）。
- 旧客户端兼容与灰度策略。

### R7 前端

- Zustand 以 `seq` 去重应用事件；重连退避。
- 切会话时行为：A 阶段连接存活则继续收流（现有 multi-runtime）；B 阶段可后台生成。
- 恢复时保留 version / feedback / toolCalls；避免重复 delta。

### R8 可观测性 / SLO

定义至少：恢复成功率、重复事件率、断线率、run stuck、TTFT、event persistence latency、队列延迟（B）。

### R9 可独立发布的实现 issue

拆成 **3–5** 个可独立发布、可回滚、各有测试与验收命令的 issue；标注写集与依赖顺序，**避免多任务并发改同一核心文件**。

### R10 明确不做

- 不引入 Pi `AgentHarness`。
- 不改变 `model_catalog` 单一事实源。
- 首阶段不做跨区域 exactly-once。
- 本设计任务不改业务代码 / schema / migration。
- 不回滚、不格式化 P0/P1/P2-A 未提交改动。

## Acceptance Criteria（本设计任务）

- [x] 存在 `task.json` / `prd.md` / `design.md` / `implement.md`，格式对齐现有 Trellis 任务。
- [x] `design.md` 基于上述真实实现，明确 A/B 边界且禁止伪装。
- [x] 给出事件契约、幂等、数据模型、状态机、API、前端、SLO 的可执行定义（含 TS 类型 / SQL 草案 / ASCII 流程 / 失败矩阵 / 迁移回滚）。
- [x] `implement.md` 拆成 3–5 个 issue，含写集、依赖、验收命令、回滚点。
- [x] 仅做文档/JSON 基础检查与 `git diff --check`；无业务代码 diff。
- [x] 工作树既有未提交业务改动保持不变。

## Out of Scope（实现期亦默认不做，除非单独立项）

- 跨 region / 多活 exactly-once 投递。
- 改网关 `/v1/chat/completions` 协议为可恢复流。
- 用事件日志替代 `messages` 作为唯一真相（messages 仍是对话树真相；events 是 run 时序日志）。
- 完整 prompt 审计归档系统。
- UI 大改视觉（仅恢复/重连所需最小状态）。

## Notes

- 依赖前置：P1-A run-lifecycle 已提供 `runId` 与 tool 审计落库；本设计在其上扩展，不推翻。
- 阶段 B 复用现有 pg-boss worker 进程，不新开 Agent 框架。
- 产品文案：A =「网络中断后可恢复已生成内容」；B =「关闭页面后仍可继续生成并回来查看」。
