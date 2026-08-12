# Provider 超时强制执行设计

## Design Goals

1. 每个真实上游 attempt 都有连接/响应头、总读取和流空闲三层边界。
2. Provider timeout 是普通可故障转移的上游失败；客户端取消与服务 drain 仍是 `interrupted`。
3. Engine 继续独占 route/key、commit、breaker 和 telemetry 状态机；adapter 不创建私有重试循环。
4. 所有协议和模态复用一个 timeout policy，不新增依赖，不使用 Node/Undici 私有 API。

## Timeout Contract

| 字段 | 精确定义 | 空值默认 | 允许范围 |
| --- | --- | ---: | ---: |
| `connectTimeoutMs` | 从调用 portable `fetch` 到取得 `Response` 响应头；包含 DNS/TCP/TLS、上游排队和 time-to-headers，不声称是 TCP-only | `60_000` | `1_000..300_000` |
| `readTimeoutMs` | 单个 route/key attempt 从开始到 adapter 完整返回的总时限，包含连接与响应体消费 | `900_000` | `10_000..3_600_000` |
| `streamIdleTimeoutMs` | 流读取期间相邻 SDK stream chunk 的最长间隔，每个 chunk 后重置 | `120_000` | `5_000..900_000` |

- 管理 UI 使用秒，允许最多三位小数以无损表达毫秒；Server Action 转换为整数毫秒。
- 空白写 `null`，运行时统一解析为默认值。`0`、负数、非有限数、非整数毫秒和越界值均拒绝。
- 现有 operation-specific budget 继续作为更严格上限。多个 deadline 竞争时保留第一个 abort reason。

## Data Flow

```text
Provider form (seconds)
  -> shared timeout parser/range policy
  -> providers nullable millisecond columns
  -> routing ResolvedProvider projection
  -> resolve effective defaults
  -> Gateway attempt read scope
     -> adapter SDK abortSignal
        -> shared Provider fetch connect scope
        -> streaming SDK chunk timeout
  -> existing error classification/fallback/breaker/telemetry
```

## Shared Policy Owner

在 `packages/core/src/lib/providers/timeouts.ts` 建立唯一 policy owner，包含：

- 默认值、上下限和字段类型。
- 空值到有效值的解析函数。
- 管理表单秒值到 nullable 毫秒 patch 的解析函数，供 admin/panel 两套 action 复用。
- `ProviderTimeoutError`，记录 `kind: "connect" | "read" | "stream_idle"` 与安全的 `timeoutMs`，错误码固定为现有 `ErrorCode.GATEWAY_TIMEOUT`。
- 可释放的信号组合 helper：组合调用方 signal 与内部 timer，保留首个 reason，并在完成后清 timer/listener。
- 共享 Provider fetch：始终保留 SDK 的 `RequestInit.signal`，只在需要时覆盖 User-Agent，并在收到响应头后立即清理 connect timer。

该模块只依赖标准 Web API 和现有错误契约。管理 Client Component 只消费常量；不新增第二份前端范围判断。

## Persistence And Admin Boundary

### PostgreSQL

- 保留三个 nullable 列和 `null -> runtime default` 语义，不增加数据库默认值。
- Drizzle schema 增加三个 nullable range check。
- 追加 PostgreSQL 迁移：先把历史越界值归一为 `null`，再增加约束；同步 journal 与 snapshot，不改写已发布迁移。
- 回滚运行时代码时约束可以保留，因为旧代码已忽略这些列且 `null` 仍兼容。

### Server Actions And DTO

- `createProvider` / `createMyProvider`：字段缺省或空白写 `null`，合法值写毫秒。
- `updateProvider` / `updateMyProvider`：表单携带 `providerTimeoutsPresent=1` 时更新三字段；字段空白显式清为 `null`。缺少 marker 的旧调用保持原值。
- admin 与 panel Provider 页面把三个 nullable 毫秒值投影到共享 `ProviderItem`，再传给编辑弹窗。
- 普通浏览器提交同时受原生 `min/max/step` 约束；Server Action 和数据库约束处理伪造请求。

### UI

- 在现有 Provider 弹窗增加一个无嵌套卡片的三列/响应式 timeout fieldset，使用 `Input type="number"`，标签和说明明确单位、默认值与语义。
- 新建时字段留空并用默认值作 placeholder；编辑时回显显式值，清空后恢复默认。
- 使用既有 `providers` next-intl namespace，同步中英文文案；不增加开关或“无限等待”选项。

## Runtime Enforcement

### Total Read Deadline In Gateway Engine

- Engine 在每个 route/key attempt 开始时按当前 route 的有效 `readTimeoutMs` 创建 scope，并把组合后的 signal 传给 adapter。
- `nextAdapterOrAbort` 收到 caller abort 时沿用现有 `interrupted` 分支；收到 read deadline 时非阻塞关闭 iterator，并把 `ProviderTimeoutError("read")` 送入现有普通失败分支。
- attempt 成功、失败、拒绝或取消后都释放 scope。读超时继续遵守 response commit：提交前可换 key/route，提交后只结束当前流。
- 该层同时约束 Chat、Image、TTS、STT 和 hosted search，即使某个 adapter 没有专用 SDK timeout 参数也不会无限占用 Engine。

### Connect / Response-Headers Deadline In Provider Fetch

- Registry 的四种 Chat factory 和 hosted search factory 始终安装共享 fetch，不再仅在传入 User-Agent 时安装。
- Image/TTS/STT 的 OpenAI factory 也使用同一 fetch。
- fetch 组合上层 attempt signal 与 connect timer。connect 先触发时主动 abort 上游并抛 `ProviderTimeoutError("connect")`；上层取消或 read timeout 先触发时保留其原始 reason。
- fetch resolve 或 reject 后立即清 connect timer/listener；响应体仍由 SDK 在 read scope 内消费。

### Stream Idle Deadline

- 普通 Chat streaming 调用向 AI SDK 传 `timeout.chunkMs = effective.streamIdleTimeoutMs`。
- hosted search 保留既有 30 秒业务 watchdog 上限，但改为 SDK chunk timeout，实际值为 `min(30_000, provider.streamIdleTimeoutMs)`；移除当前把 watchdog 转成 `AbortError` 的私有状态。
- 非流式 Chat 和媒体不应用 stream-idle，仅受 connect 与 total-read deadline。
- SDK 的 `TimeoutError` 和共享 `ProviderTimeoutError` 都映射到 `gateway.timeout`；调用方 signal 先触发时仍优先收敛为 `interrupted`。

### Provider Discovery And Deep Probe

- raw `/models` 与空 body key probe 使用共享 connect fetch，并用本地 read scope 包住 fetch、body 读取和解析。
- 深度 `generateText` / `streamText` probe 使用同一 read scope；流式复核同时使用 provider idle timeout。
- 现有 `PROBE_TIMEOUT_MS=15_000` 继续作为额外总预算，和 Provider 配置取最先触发者。未保存的表单直测使用系统默认 Provider policy。
- Provider 行触发的 health/model/route probe 与创建后模型拉取传入该行的显式 timeout 值。

## Error, Retry And Telemetry Contract

- `classifyGatewayError` 在通用 Abort/network/HTTP 判断前识别直接、`lastError` 或 bounded `cause` 链中的 Provider timeout，返回 `gateway.timeout`、HTTP `504`、phase `network` 和不含 URL/key/header 的固定安全文案。
- `isAbortError` 不把 `TimeoutError` 或 `ProviderTimeoutError` 当作客户端取消。
- timeout 继续命中现有 failoverable policy：提交前可按当前规则尝试后续 key/route并调用 `recordFailure`；提交后记录 failed attempt 和 breaker failure，但不切换上游。
- 每个真实 attempt 仍只有一条 attempt fact，logical execution 仍只 finalize 一次；route/HTTP boundary 不重复写 telemetry。

## Consumer Matrix

| 路径 | Connect | Total read | Stream idle |
| --- | --- | --- | --- |
| OpenAI Chat / Responses | shared fetch | Engine attempt scope | SDK `chunkMs`（stream only） |
| Anthropic Messages | shared fetch | Engine attempt scope | SDK `chunkMs`（stream only） |
| Gemini GenerateContent | shared fetch | Engine attempt scope | SDK `chunkMs`（stream only） |
| OpenAI-compatible Chat | shared fetch | Engine attempt scope | SDK `chunkMs`（stream only） |
| Hosted Provider search | shared fetch | Engine attempt scope | `min(provider, 30s)` |
| Image / TTS / STT | shared fetch | Engine attempt scope | 不适用 |
| `/models` / key auth probe | shared fetch | local scope + 15s cap | 不适用 |
| deep model probe | shared fetch | local scope + 15s cap | SDK `chunkMs`（stream fallback） |

## Compatibility And Rollback

- 不改变 Provider/Route API 格式、SDK、请求体、认证头、重试次数或成功响应。
- 旧行全部为 `null` 时会开始使用系统默认硬上界，这是本任务的预期行为；管理员可在范围内调高。
- 无新依赖。若上线后出现误杀，可先把受影响 Provider 调高到上限；代码回滚不要求回滚列或 check constraint。
- 迁移前把非法手工值改为 `null`，避免部署因新增约束失败；合法显式值不变。

## Rejected Alternatives

- 仅 race `fetch()`：只能约束响应头，无法约束已返回 headers 后的 body/stream。
- 只使用 AI SDK `timeout.totalMs`：媒体 API 不暴露该参数，也不能统一约束不配合 signal 的 adapter。
- 每个 adapter 各写一套 timer：会复制取消原因、清理和错误分类，容易让不同协议漂移。
- 包装所有 `Response.body`：需要重建 Response 并承担 URL/type/redirect 兼容风险；现有 Engine scope + SDK chunk timeout 已覆盖目标。
- 使用 Undici dispatcher：破坏 portable Fetch 与 Web/Core 边界，超出本任务。

## Validation Strategy

- policy 单测覆盖默认、范围、空白、毫秒精度、`0`/越界拒绝、首个 abort reason 与 timer/listener 清理。
- migration/schema 测试覆盖非法值归一、三个 check、journal/snapshot 连续。
- admin/panel action 与 Provider 表单测试覆盖创建、更新、回显、清空、旧调用 preserve 和中英文 key。
- Registry 四协议矩阵覆盖 shared fetch、User-Agent、connect timeout 与调用方 signal。
- Engine fake-timer 测试覆盖 read timeout、caller-first/timeout-first、pre-commit fallback、post-commit stop、breaker、iterator close 和单次 finalize。
- stream/hosted tests 覆盖 idle reset、持续 chunk、首 chunk 后停滞和 30 秒业务上限。
- media/probe 测试覆盖 Image/TTS/STT 与 raw/deep probe 接线。
