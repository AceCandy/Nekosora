# Gateway 请求流量治理设计

## Design Goals

1. 所有 API Key 鉴权的 Gateway 入口都有跨实例一致的 Key/用户双层速率边界。
2. Provider/RAG 工作持有可续租并可崩溃恢复的双层并发名额。
3. Chat、Image、TTS、STT 使用独立单位，在 Provider 前预留、终态只结算一次。
4. PostgreSQL 是唯一正确性来源；Redis、进程内计数与 telemetry sink 都不能决定放行。
5. 不改变主/子 Key 权限、模型绑定、route/key failover、response commit 或 Web Chat 行为。

## Policy Contract

### Defaults

| 维度 | Key | User | 允许范围 |
|---|---:|---:|---:|
| RPM | 120 | 600 | `1..1,000,000` |
| Burst | 30 | 120 | `1..1,000,000` |
| Concurrency | 8 | 32 | `1..100,000` |
| Chat tokens/month | 10,000,000 | 50,000,000 | `1..1,000,000,000,000` |
| Image count/month | 1,000 | 5,000 | `1..1,000,000,000,000` |
| TTS code points/month | 1,000,000 | 5,000,000 | `1..1,000,000,000,000` |
| STT seconds/month | 36,000 | 180,000 | `1..1,000,000,000,000` |

- 所有值必须是十进制安全整数且大于零；`0` 不表示关闭，首期没有 unlimited/disable 语义。
- User 值允许小于 Key 值，用于配置更严格的共享上限；不增加跨字段隐式修正。
- 租约 TTL 固定 `120s`、续租周期固定 `30s`，使用 PostgreSQL 时钟，不进入管理配置。
- 月窗口固定 UTC 自然月。跨月执行归入预留发生的月份，不能在完成时漂移到下月。

### Storage

策略保存为 `system_settings(namespace='gateway', key='request_governance_v1')` 的单个版本化 JSON：

```ts
interface GatewayGovernancePolicyV1 {
  version: 1;
  key: GatewayScopeLimits;
  user: GatewayScopeLimits;
}
```

- `policy.ts` 是默认值、Zod schema、范围和表单解析的唯一 owner；管理端与运行时复用，不在组件或路由复制判断。
- 专用 repository 用 `INSERT ... ON CONFLICT DO UPDATE` 单行原子保存。运行时对校验后的有效 policy 生成确定性的 canonical fingerprint，避免用可能重复或回拨的时间戳判断策略变化。
- 缺少配置行时直接使用上述代码默认值，因此旧部署迁移后立即受保护，无需 seed 数据。
- 管理端不会写出非法 JSON。若手工改库造成值损坏，运行时使用同一套安全默认值并增加低基数配置错误指标；数据库读取失败则失败关闭为 503。
- 运行时每次 admission 从 PostgreSQL 读取策略，不使用 Redis/进程缓存，保证多实例看到已提交的新策略。

## Endpoint Matrix

| 入口 | Rate | Concurrency | Monthly quota |
|---|---|---|---|
| OpenAI Chat / Responses | Key + User | Key + User | Chat token |
| Anthropic Messages | Key + User | Key + User | Chat token |
| Gemini `/v1beta/models/*` generate/stream | Key + User | Key + User | Chat token |
| `/v1/images/generations` | Key + User | Key + User | Image count |
| `/v1/audio/speech` | Key + User | Key + User | TTS code point |
| `/v1/audio/transcriptions` | Key + User | Key + User | STT second |
| `GET /v1/models` | Key + User | none | none |
| `POST /v1/mcp` initialize/list | Key + User | none | none |
| `POST /v1/mcp` `search_knowledge` | Key + User | Key + User | none |
| `GET /v1/mcp` 固定 405 | none | none | none |

- Rate 在鉴权成功后执行，并在 Core 的 JSON/FormData 语义解析前提交；无效 body、并发拒绝和配额拒绝仍消耗一次 RPM。
- Fastify 已在 Core handler 之前接收并限制 HTTP body；本任务不宣称替代边缘 WAF、连接级或匿名 IP 防护。
- 已知会调用 Provider 的入口在语义解析期间也持有租约；MCP 先解析小型 JSON，仅 `search_knowledge` 获取租约。

## PostgreSQL Model

### `gateway_governance_subjects`

Key 和 User 各有一行，既保存 token-bucket 状态，也充当所有治理事务的稳定锁点：

- `id` UUID primary key。
- `user_id` / `api_key_id` 二选一，分别使用 `ON DELETE CASCADE` FK；CHECK 保证恰有一个非空，partial unique index 保证每个主体只有一行。
- `rate_tokens numeric(20,6)` 与 `rate_refilled_at timestamptz` 均非空，token 余额有非负 CHECK。
- `policy_fingerprint text` 非空；有效策略内容变化时把余额重置为新 burst，并用数据库当前时间重置 refill 起点，避免用新 RPM 回算旧策略下的时间段。同值重复保存不会重置余额。
- `created_at`、`updated_at` 均为 `timestamptz`。

### `gateway_quota_windows`

- `subject_id` 使用 `ON DELETE CASCADE` FK 指向主体；`quota_kind` 为 `chat_tokens | image_count | tts_code_points | stt_seconds`。
- `month_start timestamptz` 保存 UTC 月初。
- `reserved_units bigint` 保存活动预留，`used_units bigint` 保存已结算或保守计费用量。
- unique `(subject_id, quota_kind, month_start)`；两个计数均有非负 CHECK，月起点有 UTC 月初 CHECK。

Admission 使用 `used + reserved + requested <= configured limit`。预留与实际分列使管理员能够区分正在执行的占额和已结算用量。

### `gateway_governance_leases`

该表只保存活动或等待回收的请求，终态事务删除行，不形成永久增长的第二套执行日志：

- `id` UUID primary key，是唯一治理请求 ID。
- `key_subject_id`、`user_subject_id` 均为非空 FK，使用 `ON DELETE RESTRICT`，避免删除单侧主体时遗留另一侧 reservation；`operation` 为低基数枚举。
- nullable `quota_kind`、`quota_month_start`，以及 nullable `reserved_units bigint`；三者必须同时为 NULL 或同时非 NULL，非 NULL 时 `reserved_units > 0`。
- nullable `provider_started_at`；首个真实 adapter invocation 前严格写入。
- `lease_expires_at timestamptz`、`created_at timestamptz`。
- Key/User/expiry 复合索引支持活动计数和过期回收；迁移测试必须验证两条 subject FK、删除限制与全部 CHECK。

并发只统计 `lease_expires_at > statement_timestamp()` 的行。终态在同一事务中锁 lease、调整两个 quota window、删除 lease；并发重复 finalize 在等待后读不到行并直接 no-op，因此不会重复扣减。

## Transaction And Lock Order

所有事务固定按以下顺序加锁，禁止任何路径从 subject 反向获取 lease：

1. 事务涉及的现有 lease 先按 `lease.id ASC` 执行 `FOR UPDATE`。
2. 锁 Key subject，再锁 User subject。
3. 需要额度时，锁 lease 记录的 Key quota window，再锁 User quota window；不得用当前月份替代 lease 中的 `quota_month_start`。

Consume Rate 没有 lease，从 subject 开始。Acquire 尚无新 lease，但必须先锁定该 Key 或 User 关联的现有 lease 集合，再锁 subjects；subjects 将并发 acquire 串行化，随后重新读取数据库时间、计数并插入新 lease。禁止使用应用服务器时间。

### 1. Consume Rate

1. `ON CONFLICT DO NOTHING` 确保 Key/User subject 行存在，再按固定顺序 `FOR UPDATE`。
2. 用 `statement_timestamp()` 和 policy RPM 补充 token，余额上限为 burst；policy fingerprint 变化时重置到新 burst 和当前数据库 refill 起点。
3. 任一余额小于 1 时不消费两侧 token，返回失败 scope 与取得下一 token 的秒数。
4. 两侧都允许时各减 1 并提交。后续 body 或 quota 失败不退还 RPM。

### 2. Acquire Concurrency Lease

1. 查询该 Key 或 User 关联的现有 lease，按 `id ASC FOR UPDATE` 锁定，再锁 Key/User subjects；等待后必须重新使用数据库时间判断 fresh/expired。
2. 在同一事务内收敛已锁定的过期 lease：无 reservation 直接删除；Provider 未开始则从 lease 记录月份的两个窗口退款；已开始则把 reservation 从 `reserved_units` 移入 `used_units`，最后删除 lease。
3. 统计两侧 fresh lease，任一达到 concurrency 上限即拒绝且不插入。
4. 插入一个同时归属 Key/User 的 120 秒 lease并提交，随后启动 30 秒单飞 heartbeat。

Rate 与 lease 是两个事务，确保并发拒绝、无效 body 和配额拒绝仍被 RPM 计数。

除目标主体的同步收敛外，运行时以固定小批量执行全局过期清理，防止不再请求的主体永久遗留行。全局 reaper 每个事务只处理一个 `FOR UPDATE SKIP LOCKED` 选中的过期 lease，再按统一顺序锁 subjects 和 lease 记录的 quota windows；批量大小和调度周期是内部常量，不进入管理员策略。reaper 是 best-effort 存储维护，失败不改变当前请求判定；目标主体收敛仍属于严格 admission 事务。

### 3. Reserve Quota

1. 在请求字段验证和单位计算后锁 lease；lease 缺失或已过期时拒绝触网。
2. 锁两个主体与当前 UTC 月的两个 quota window。
3. 任一 `used + reserved + requested` 超限时不改变窗口并删除 lease，返回相应 scope。
4. 两侧 `reserved_units += requested`，把 kind/month/units 写入 lease。

### 4. Provider Commitment, Heartbeat And Settlement

- Engine 在选中 adapter/key 后、真实 adapter invocation 前调用严格的 `markProviderStarted`。rejected route 不标记；route/key 重试只命中一次 DB。
- lease ID 本身是生命周期 ownership token，不增加第二个可变 owner。`markProviderStarted` 与 heartbeat 只能命中 `id` 匹配且 `lease_expires_at > statement_timestamp()` 的行；重复 mark 是幂等成功，缺失或过期是治理失败，heartbeat 永远不能复活过期 lease。
- 标记或 heartbeat 失败会以专用治理错误中止同一上游 signal。Engine 必须把它分类为服务不可用，而不是客户端 `interrupted`、Provider failure 或 breaker failure。
- heartbeat 使用原始 Promise 单飞；终态、Abort 和 stream cancel 先停止未来 tick，再结算。
- Provider 未开始：actual 固定 0，全部退款。
- Provider 已开始且有可靠 usage/result：actual 使用真实单位。
- Provider 已开始但 usage 缺失、失败、取消或进程失联：actual 使用 reserved，避免按零绕过成本边界。
- 结算事务执行 `reserved -= reservation`、`used += actual` 后删除 lease。actual 超过 reservation 时允许窗口进入 over-limit，并记录低基数 overage 指标；后续请求继续拒绝。
- finalize 与 reaper 都必须先 `FOR UPDATE` 锁同一 lease，再在同一事务调整窗口并删除；取得行锁的一方是唯一结算者，等待方重读不到 lease 后 no-op。finalize 可结算尚未被回收的过期 lease；reaper 已删除后的迟到 finalize 不得再次调整窗口。

## Metering Contract

### Chat

- 预留输入使用现有 `estimateMessagesTokens`，输出使用客户端显式 `max_tokens`；缺省时读取 `model_catalog.maxOutputTokens`，再回退现有 `16,384`。输出值受目录 `contextWindow` 约束，目录缺失时沿用现有 `32,000` 兼容窗口。
- reservation 是 admission 上界，不是账单事实。结算优先使用有限、非负的 `totalTokens`；缺少 total 时使用 `inputTokens + outputTokens`。reasoning/cache 是明细，不重复相加。
- 完整 usage 少于 reservation 时退款差额；部分/缺失/无效 usage 或中断按 reservation 结算。
- tools/protocol fallback 与所有 route/key attempts 共用同一 lease。治理不得放进 `executeGateway` 的 attempt 循环。

兼容上游的 tokenizer 与目录可能不准确，真实 usage 可超过 reservation。该差额必须入账并阻断后续请求，而不能截断、丢弃或写零；这是 arbitrary-compatible upstream 下保留的可观测风险。

### Image

- `n` 必须是 `1..10` 的整数，缺省 1；先按 `n` 预留。
- 成功按 `result.images.length` 结算，少返回即退款。多返回视为 adapter contract violation，但仍按实际数量入账并记录 overage。
- Provider 开始后失败且没有结果时按请求 `n` 保守结算。
- `size` 与 `response_format` 保持当前兼容行为；本任务只新增形成可靠 reservation 所必需的 `n` 校验。

### TTS

- 输入必须是非空字符串；保留现有 4096 输入上限，改为使用 `Array.from(input).length` 计算 Unicode code point，校验和额度共用同一函数。
- `response_format` 保持当前兼容行为，不在计量治理任务中新增格式白名单。
- 单位在请求前已经确定；Provider 未开始退款，开始后无论成功、失败或取消均按该输入 code point 数结算。

### STT

- 保留 25 MiB 文件上限，新增 `music-metadata@11.14.0`，用 `parseBuffer(buffer, { mimeType }, { duration: true })` 在内存中读取内容事实。
- 只接受可识别为 FLAC、MP3/MPEG、MP4/M4A、AAC、Ogg/Opus、WAV 或 WebM/Matroska 且含有限正 duration 的音频；不信任上传 MIME 或扩展名。
- 单位为 `ceil(durationSeconds)`。损坏、无音轨、零时长、非音频或不支持容器在 Provider 前返回请求错误。
- Provider 未开始退款，开始后按已解析秒数结算；绝不以字节数估算。

### Usage Telemetry

- 扩展 `IRUsage` 与 `gateway_executions/gateway_attempts` 的媒体用量字段，使成功的 Image/TTS/STT attempt 和 logical execution 可审计。
- 现有 Chat token 字段保持兼容。治理结算是严格路径；现有 telemetry 仍是 best-effort，不能反向决定是否扣减或放行。

## Runtime Integration

- 新领域放在 `packages/core/src/lib/gateway-governance/`：`policy.ts` 拥有配置与单位，`repository.ts` 拥有事务，`lifecycle.ts` 拥有 heartbeat/settle。只建立这三个真实职责，不增加 provider-specific limiter。
- 四种 Chat ingress 在 `handleProtocolRequest` 认证后调用 rate，再获取 lease；解析后预留 Chat quota。`streamChat` 的外层 `finally` 是唯一结算点，流 body 结束、cancel 与 Abort 都会进入该路径。
- 流式成功终止帧必须等严格 settlement 完成后再发送；若 settlement 失败且 HTTP 已提交，则发送协议内服务不可用终态并关闭流，不能先发送成功终态再报告治理失败。
- Image/TTS/STT handler 在鉴权后调用 rate/lease，验证并计算单位后 reserve；三个 `*ViaRoute` 把同一 governance handle 和 `request.signal` 交给 Engine，在 `try/finally` 结算。
- `executeGateway` 只增加一个严格的首个 Provider attempt hook 和治理 abort reason 分类；不移动 route/key loop、commit、breaker 或 telemetry ownership。
- MCP `search_knowledge` 用 concurrency-only lease 包住 `retrieve`；普通 MCP 方法和 `/v1/models` 只消费 rate。
- media 当前缺失的 HTTP `request.signal` 必须贯穿 route -> multimodal service -> Engine -> AI SDK。
- Gateway 每个进程启动一个固定周期、单飞且 `unref` 的全局 reaper controller；复用现有 recovery scheduler 生命周期，在 `server.onClose` 中先等待 reaper 停止，再关闭 PostgreSQL。多实例用 `SKIP LOCKED` 分工，失败只记录固定低基数阶段信息。

## Error And Retry Contract

- 新增三个彼此独立的稳定错误码：`gateway.rate_limit_exceeded`、`gateway.concurrency_limit_exceeded`、`gateway.quota_exceeded`。三者均为 HTTP 429；OpenAI 风格 `type` 保持 `rate_limit_exceeded`，但 `error.code` 必须保留具体治理码。
- Chat 四协议继续由 `protocolErrorResponse` 转换外层 envelope，Image/TTS/STT 继续使用 OpenAI 风格 JSON。所有协议额外返回同一个稳定 `X-Gateway-Error-Code` header，使 Anthropic/Gemini 无需改变标准 body 结构也能区分三种原因。
- 所有 429 带整数 `Retry-After`：rate 为下一 token，concurrency 为最早 fresh lease 到期，quota 为下一 UTC 月开始。双 scope 同时失败时返回更长等待时间；OpenAI 风格 body 的可选 details 给出稳定 `scope/resource`，不暴露 ID。
- PostgreSQL policy/admission 与 `markProviderStarted` 失败使用现有 `server.service_unavailable`，在响应提交前映射为 HTTP 503，且不得调用 Provider。
- heartbeat/settlement 失败同样归类为 `server.service_unavailable`，立即中止当前上游且不得继续 Provider attempt、切换 route/key 或更新 breaker；未提交响应返回 HTTP 503，已提交的流式响应只能发送协议内服务不可用终态并关闭流。
- Provider 自己返回的 429 仍是 upstream attempt，不得混入客户端 quota 状态。

## Admin UI

- `/admin/settings?tab=governance` 新增第五个服务端 Tab；`SettingsTabs` 使用 `flex-wrap` 和现有 `touch-target`，避免窄屏横向溢出。
- `GovernanceSettingsSection` 负责鉴权和读取有效 policy；一个轻量 Client form 使用 `useActionState` 提供 saving/success/error 状态，Server Action 再次 `requireAdmin` 并整组校验。
- 页面使用一个无投影、无嵌套卡片的表单：吞吐字段组按 Key/User 展示 RPM、Burst、Concurrency；月额度字段组按四种单位展示 Key/User 两列。
- 桌面使用稳定三列数据布局，窄屏改为按 scope 堆叠，不依赖横向滚动或流式字号。输入使用现有 `Input type="number"`，标签与 `id/htmlFor` 关联，单位文本通过 `aria-describedby` 提供。
- 保存使用现有 `Button` + Lucide `Save`；错误使用 inline `role="alert"`，成功使用 status 文本。只使用亮色语义 token、8px 以内圆角和静态无阴影状态。
- 同步 `zh-CN.json` / `en.json`，不增加运行时帮助文案、图表、套餐 UI 或可关闭开关。

## Metrics And Logging

- 新增低基数指标：rejection `{reason, scope, operation}`、settlement `{quota_kind, outcome}`、failure `{stage}`。禁止 user/key/request/model/route/provider 标签。
- 不记录原始 API Key、Key preview、请求体、音频元数据或数据库错误对象。日志只允许固定阶段文案。
- rate/concurrency 拒绝不额外写一张逐请求审计表，避免攻击流量放大持久化；quota window、活动 reservation 与现有 execution/attempt facts 提供状态证据。

## Migration, Rollout And Rollback

- 追加新的 PostgreSQL migration、Drizzle journal 与 snapshot；不改写 `0000..0009`。
- 迁移只建 enum/table/index/check 和媒体 usage nullable 列，无历史数据回填或表重写。上线前评估普通索引锁窗口。
- `system_settings` 无需 schema/data migration；代码默认即启用确认策略。
- `music-metadata` 加入 Core，并按 Gateway bundle 契约同时成为 `apps/gateway` 直接 runtime dependency；复核 lockfile、ESM 加载和 `pnpm build:gateway`。
- 滚动升级时旧实例不执行治理，新实例执行；部署窗口不能声称全局边界已经完全生效。完成 Gateway 全副本切换后才视为启用。
- 紧急缓解先由管理员在允许范围内调高阈值。代码回滚可保留新表、nullable usage 列和配置 JSON，旧代码不会读取；不能通过删表回滚。

## Validation Strategy

- policy/metering 单测：默认值、范围、整组拒绝、canonical policy fingerprint、四单位边界、Chat usage fallback、Unicode 与音频 duration。
- repository 真实 PostgreSQL 测试：Key/User 双锁竞争、rate refill、并发 winner、fresh/expired lease、heartbeat、Provider 前退款、开始后保守结算、actual 差额、重复 finalize、UTC 月切换、策略变更，以及 policy/admission/renew/settle 故障注入。并发矩阵必须包含 `acquire x finalize`、`reap x finalize`、`reap x heartbeat`、`reap x mark-start`、`reserve x reap`，断言无死锁、lease 最终状态确定且 reservation/used 只变化一次。
- migration 测试：SQL/journal/snapshot 连续、FK/delete behavior/index/check/nullable usage 列，且无旧迁移改写。
- HTTP/协议矩阵：显式覆盖 Gemini `/v1beta/models/*` 在内的所有入口 rate；Provider/RAG 矩阵覆盖 concurrency；四模态 quota 拒绝均证明 Provider 未调用。
- stream/Engine：工具 fallback、route/key retry、commit 后失败、client cancel、heartbeat/settlement failure、迭代器关闭和单次结算；治理 DB 故障不得触发后续 Provider attempt、failover 或 breaker 更新，并分别验证提交前 503 与提交后协议终态。Gateway close 测试必须等待在途 reaper 并在停表后再关闭 DB。
- admin：权限、默认回显、整组保存、越界不写、i18n 对称、移动布局无溢出与键盘焦点。
- dependency/build：`pnpm install --frozen-lockfile`、Core/Web/Gateway 定向测试、`pnpm check`、`pnpm test`、`pnpm build`、`pnpm build:gateway`、`git diff --check`。
