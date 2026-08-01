# Gateway Execution Engine Design

## 1. Problem

Nekusora 已有成熟的 route 排序、key bundle、错误分类与 breaker 规则，但执行控制流分散在 `streamChat`、`generateChat`、图像、TTS 与 STT implementation 中。Chat 两条路径复制 retry 循环，媒体路径则只消费 `routes[0]` 和首 key。失败尝试、最终 usage 与 metrics 又分散到两套日志表和 route 层补写逻辑，导致同一逻辑请求没有单一事实模型。

本设计建立一个 deep Gateway execution module。它拥有 route/key 尝试状态机和执行事实；模态 adapter 只负责协议特有的请求、事件和结果翻译。

## 2. Non-Negotiable Invariants

- `/v1/*` 保持 OpenAI SDK 可调用的 wire contract。
- 网关 owner-only、WebChat by-id visibility、子 key binding 与 route priority/weight 不变。
- AI SDK 内建 retry 保持关闭；所有重试由 execution module 决定。
- 流式 text、reasoning、tool-call 一旦输出即 commit，之后禁止换 key/route。
- Abort 不重试、不 failover、不计为 provider failure。
- 可转移错误始终反馈 breaker，确定性请求/配置错误不得污染 breaker。
- 明文 key/header 只存在于 execution 安全域。attempt adapter 可向 engine 抛原始上游 Error；engine 必须立即用精确 secrets 完成重试判定、分类与脱敏，安全域之外只传 safe error 和 key mask。
- 日志破坏性迁移只清理 `usage_logs` 与 `ops_error_logs`，不触碰 `runs`、`tool_calls` 或业务数据。

## 3. Design Alternatives

### A. Shared retry helpers

抽取 `tryKeys`、`tryRoutes`、`logFailure` 等函数，各模态继续拥有自己的循环。

拒绝原因：interface 几乎等于当前 implementation；commit、Abort、breaker 和 telemetry 顺序仍由每个调用方拼装。删除测试只会把复杂度搬回调用方，不能形成 deep module。

### B. Caller-driven execution plan

module 产出 attempts，调用方执行后回报 success/failure/committed。

拒绝原因：调用方仍能漏报 breaker、重复写日志或在 commit 后继续取下一 attempt。interface 暴露整个状态机，难以强制契约。

### C. Engine-owned async generator state machine

选择。engine 解析 route、生成 key attempt、调用模态 adapter、消费 adapter 事件并掌握 commit 状态，最终产出统一 outcome。原子模态 adapter 不 yield 中间事件，只 return 结果；流式 Chat adapter yield 带 commit 标记的事件。

该形态让 engine implementation 深，而 interface 只表达“怎样执行一次协议 attempt”和“哪些事件不可撤回”。

## 4. Module Boundaries

### 4.1 `gateway-execution` module

建议目录：`src/lib/gateway-execution/`。

职责：

- 解析 by-name/by-id/capability route chain。
- 按 route 顺序和 key 权重生成最多 `MAX_KEY_ATTEMPTS` 的真实 attempts。
- 驱动 adapter 的 async generator，转发模态事件并记录 response commit。
- 在持有 attempt key/header 时捕获 raw error，完成重试判定、分类与脱敏；raw error 不得离开 module。
- 决定同 provider 换 key、跨 provider failover、停止或 Abort。
- 更新 breaker success/failure。
- 写 execution/attempt telemetry，最终只对逻辑执行计一次 metrics。
- 返回统一 final outcome；调用方将其翻译成既有 OpenAI wire response。

非职责：

- 构造 OpenAI/Anthropic/Google payload。
- 解释 Chat tool loop、图像 base64、音频二进制或 HTTP/SSE 格式。
- 决定模型可见性、route 排序或 key 权重算法。

### 4.2 Attempt adapter seam

概念 contract：

```ts
type GatewayOperation =
  | "chat.stream"
  | "chat.generate"
  | "image.generate"
  | "audio.speech"
  | "audio.transcription";

interface AttemptContext {
  executionId: string;
  attempt: number;
  operation: GatewayOperation;
  route: ResolvedRoute;
  apiKey: string;
  abortSignal?: AbortSignal;
}

interface AttemptEvent<T> {
  value: T;
  commitsResponse: boolean;
}

interface AttemptResult<T> {
  value: T;
  usage?: IRUsage;
  firstTokenAt?: number;
}

type AttemptAdapter<TEvent, TResult> = (
  context: AttemptContext,
) => AsyncGenerator<AttemptEvent<TEvent>, AttemptResult<TResult>, void>;
```

最终命名可随实现调整，但不得把 route/key 循环、retry 判断、breaker 或日志写入 adapter。

原子 adapter 用 async generator return `AttemptResult`；Chat stream adapter yield `AttemptEvent<StreamEvent>`。engine 手动消费 iterator，以同时获得事件和 generator return value。

### 4.3 Provider adapter registry

registry 以 `(operation, provider.protocol)` 选择 adapter factory：

| Operation | Supported protocol families |
| --- | --- |
| Chat | `openai`, `openai-compatible`, `anthropic`, `gemini` |
| Image | `openai`, `openai-compatible`, `openai-images` |
| TTS | `openai`, `openai-compatible`, `openai-audio-tts` |
| STT | `openai`, `openai-compatible`, `openai-audio-stt` |

不兼容 route 是确定性 route 配置失败：不调用上游、不更新 breaker，记录失败 attempt 后继续下一 route。全部 route 不兼容时，execution 以稳定的 protocol/capability error 失败。

## 5. Execution State Machine

1. 创建 `gateway_executions(status=running)`；写失败遵循现有 telemetry best-effort 原则，不阻断网关请求。
2. 解析 route chain。解析失败直接 finalize execution，无 upstream attempt。
3. 对每条 route：
   - 从 `route.provider.keys` 生成加权无放回 key 序列并应用 attempt 上限。
   - registry 无匹配 adapter 时记录配置失败 attempt，继续下一 route。
   - 创建 running attempt，执行 adapter。
   - 每个输出事件在转发前根据 `commitsResponse` 单向设置 committed。
   - 成功：完成 attempt，`recordSuccess`，finalize execution，停止。
   - Abort：attempt/execution 记 interrupted，不更新 breaker，停止。
   - 失败：先分类和脱敏，完成 attempt；若可转移则 `recordFailure`。
   - 未 commit 且 key retryable 时换 key；未 commit 且 route failoverable 时换 route。
   - 已 commit 时禁止任何后续 attempt，finalize failed 并让流式调用方输出既有 error event。
4. engine 在 `finally` 保证 execution 从 running 收敛；metrics 仅按 final outcome 计一次。

## 6. Observability Model

### 6.1 `gateway_executions`

一行代表一次用户可见或后台逻辑执行。主要字段：

- identity：`id`, `request_id`, `operation`, `source`, `request_path`
- caller：`user_id`, `api_key_id`, `key_kind`
- request：`model`, `model_id`, `stream`
- outcome：`status`, `error_code`, `error_message`, `error_phase`, `http_status`
- usage：prompt/completion/cache/reasoning token，`latency_ms`, `first_token_latency_ms`
- selected route snapshot：provider/route/upstream model/upstream key mask
- lifecycle：`started_at`, `completed_at`, `created_at`

`request_id` 保持现有 run/request 关联语义；逻辑执行只有一个 final outcome。

### 6.2 `gateway_attempts`

一行代表一次真实上游调用或因 adapter 不兼容而拒绝的 route attempt：

- `execution_id` FK cascade + `attempt`，联合唯一。
- route/provider/upstream/key mask snapshot。
- `status`: `running | success | failed | interrupted | rejected`。
- error classification、HTTP status、latency、attempt usage、时间戳。

管理页由 execution 列表进入 attempt chain；聚合统计只读取 final executions，provider 健康与 retry 诊断读取 attempts。

### 6.3 Destructive migration

- 追加 `0001_gateway_execution_observability.sql`，不改写 `0000_baseline.sql`。
- drop `ops_error_logs`、`usage_logs` 及其数据，再创建新表、FK 和索引。
- 更新 `src/db/schema/pg.ts`、Drizzle journal/snapshot 和 schema/migration tests。
- `runs` / `tool_calls` 保持原样；它们属于 Chat runtime audit，不并入 gateway execution 日志。

### 6.4 Metrics

- 逻辑执行 counter 只在 final outcome 增加一次。
- 新增 upstream attempt counter，按 operation/status/provider protocol 聚合，禁止携带 model、routeId、key 等高基数字段。
- 旧 `nekusora_requests_total` 可破坏性替换，但 smoke tests、metrics 文档与 dashboard 查询必须同步。

## 7. Public Response Compatibility

- Chat completion JSON/SSE、Images、Audio 成功 payload 保持 OpenAI SDK 可解析。
- 允许统一错误 code/type/status，但仍使用项目的 OpenAI-style error envelope 和本地化机制。
- 流式 commit 后仍保留已输出 chunks，追加一个脱敏 error frame，不拼接其他上游。
- 原子模态只在成功后对客户端可见，因此失败前可安全换 key/route。

## 8. Migration Slices

1. Characterization tests 固定现有 wire payload、route visibility、commit 和 breaker 契约。
2. 新 observability schema/repository/管理页查询落地，旧写入尚未切换前测试保持可独立验证。
3. engine + fake adapters contract tests 落地，不接生产入口。
4. `generateChat` 和 `streamChat` 切换到 engine；Agent loop 保持在 engine 之外。
5. 图像切换并补多 key/multi-route。
6. TTS/STT 切换并补 protocol registry。
7. 删除旧 retry/logging implementation 和 route 层日志补写。

每个切片失败时回滚该切片，不回滚已验证的数据 schema；在入口全部迁移前不得删除旧 implementation。

## 9. Risks

- engine async generator 的 return/throw/Abort 清理错误可能留下 running execution。
- commit 标记晚于事件转发会造成跨上游内容拼接。
- 双层 telemetry 若 finalization 失败可能出现 running 残留；查询需能识别并显示不完整执行。
- adapter protocol 矩阵会暴露过去被 OpenAI 强制构造掩盖的错误配置。
- 日志表 drop 不可恢复；用户已确认项目未上线且允许清空，执行前仍需在迁移 SQL 中严格限定表名。
- 媒体接口新增重试可能增加单请求延迟与上游费用；attempt 上限必须统一且可观测。

## 10. Rollback

- 代码 rollback：保留旧入口 implementation 到所有新 contract tests 通过；按模态逐一切回。
- schema rollback：本任务不承诺恢复旧日志数据。若新 schema 失败，修复/追加 forward migration；不得改写已执行的 `0001`。
- wire rollback：characterization tests 作为 OpenAI SDK compatibility gate，任一失败阻止切换入口。
