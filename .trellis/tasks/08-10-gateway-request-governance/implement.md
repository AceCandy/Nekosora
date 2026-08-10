# Gateway 请求流量治理实施计划

## Success Gate

- PRD 的 Key/User 双层 rate、concurrency 与四种月额度全部在 PostgreSQL 原子执行。
- 默认值迁移后立即生效，UTC 月窗口、120/30 秒租约和所有退款/保守结算语义均有自动化证据。
- Endpoint Matrix 每个入口（包括 Gemini `/v1beta/models/*`）都有定向测试；拒绝路径不调用 Provider/RAG，重试与重复 finalize 不重复扣减。
- 管理 UI、错误/i18n、metrics、媒体 usage、SQL/journal/snapshot 和新增依赖同步。
- 真实 PostgreSQL 并发测试、`pnpm check`、`pnpm test`、Web/Gateway build、diff check 与独立复核通过。

## Step 1: Lock Contracts With Failing Tests

1. 为 policy 写默认值、范围、单 JSON schema、canonical fingerprint、同值保存和无效配置 fallback 测试。
2. 为四种 meter 写预留/实际/fallback 测试：Chat usage、Image `n`、TTS code point 与既有 4096 上限、STT duration/format；断言 Image/TTS 格式字段保持现有兼容行为。
3. 为 repository 建立真实 PostgreSQL 测试骨架，先覆盖同一 Key/User 并发 admission 只能产生规定数量 winner。
4. 为 HTTP/协议、Engine、媒体和 MCP 增加最小失败用例，证明当前缺少 rate/lease/quota 接线。

Verify: 只运行新增定向测试，确认失败来自尚未实现的治理行为，而不是 fixture、时钟或数据库隔离错误。

## Step 2: Add Schema, Migration And Policy Owner

1. 在 `packages/db/src/schema.ts` 增加 governance subject/quota/lease enum、表、明确的 FK/delete behavior、partial unique、索引和 CHECK；lease 的 quota 三字段必须全空或全非空且 reservation 为正。为 execution/attempt 增加 nullable 媒体 usage 字段。
2. 生成下一条 PostgreSQL migration，并同步 `_journal.json` 与最新 snapshot；只追加，不修改已发布迁移。
3. 新增 `gateway-governance/policy.ts`，实现版本化 Zod schema、默认值、范围、配置 DTO 和表单解析。
4. 为 `system_settings` 增加专用单行原子 load/save repository，不改变通用 service 的其他调用语义。

Verify: schema/migration/policy 定向测试；检查迁移无历史大表 UPDATE，旧 SQL hash 与 journal 条目未变化。

Rollback point: 仅新增兼容表、nullable 列与未接线 policy，尚未改变请求行为。

## Step 3: Implement PostgreSQL Admission And Lifecycle

1. 实现 rate token bucket，Key/User 行按固定顺序锁定，使用 `statement_timestamp()` 和 canonical policy fingerprint。
2. 实现统一锁序：相关 lease 按 ID 排序、再 Key/User subjects、再 lease 记录月份的 Key/User quota windows；任何路径不得 subject -> lease 反向加锁。
3. 实现 concurrency lease acquire/heartbeat、active predicate、同主体过期收敛与固定小批量全局 reaper；全局清理每个事务只处理一个 `FOR UPDATE SKIP LOCKED` lease，并暴露可等待停止的单飞 controller。
4. 实现 UTC month quota reserve，以及终态 actual-reserved 差额、Provider 前退款、开始后保守结算。
5. finalize/reaper 先锁 lease，再在一个事务内调整两个窗口并删除；missing lease 作为竞争失败或重复终态 no-op。
6. mark-start/heartbeat 只更新仍未过期的匹配 lease；重复 mark 幂等，缺失/过期失败，迟到 heartbeat 不得复活 lease。
7. lifecycle 使用 30 秒单飞 heartbeat，并提供可组合的治理 abort reason；所有 timer/listener 可释放。

Verify: 真实 PostgreSQL 覆盖多连接竞争、锁顺序、等待跨过 expiry、月切换、策略更新、actual overage、并发 finalize 和进程失联收敛；交叉矩阵至少包含 `acquire x finalize`、`reap x finalize`、`reap x heartbeat`、`reap x mark-start`、`reserve x reap`，断言无死锁且窗口只变化一次。故障注入覆盖 policy/admission/renew/settle，确认失败关闭且预留不会被错误退款或重复扣减。

Rollback point: repository 可保留但尚未被 HTTP/Engine 调用，不影响生产请求。

## Step 4: Wire Errors, Metrics And Admin Configuration

1. 增加三个独立 429 错误码、请求参数错误映射、双语错误文案、`Retry-After` 与统一 `X-Gateway-Error-Code` header；OpenAI `error.code` 保留具体治理码，Anthropic/Gemini body 保持协议结构。
2. 在 `@nekusora/observability` 增加低基数 rejection/settlement/failure 指标与 Core wrapper。
3. 新增 Governance settings Tab、Server Section、`useActionState` 表单和原子 Server Action；同步五 Tab 类型、wrapping/touch target 与中英文文案。
4. 管理端只消费 shared policy DTO；伪造、越界或部分输入整组不写，成功 revalidate 当前 settings 页。

Verify: error/meta/i18n、四协议 envelope/header、三类稳定码、metrics label、admin action/component/catalog 定向测试；320/390/768/1280px 检查无横向溢出和键盘焦点可见。

## Step 5: Enforce Rate And Concurrency Across Endpoint Matrix

1. 四协议共享 handler 在认证后消费 rate、获取 lease，所有 setup/body/error 分支释放或转交 lease ownership。
2. Gemini `/v1beta/models/*`、Image/TTS/STT、models 与 MCP 分别接入对应 matrix；RAG 只持 concurrency，不伪造月额度。
3. 为 media 补齐 `Request.signal -> multimodal service -> Engine -> AI SDK` 传播。
4. heartbeat failure 使用专用失败分类，阻止 Provider/failover/breaker，client Abort 仍保持 interrupted。
5. Gateway 启动固定周期全局 reaper，并在 `server.onClose` 中先等待 controller 停止、再关闭 DB；多实例并发清理由 `SKIP LOCKED` 协调。

Verify: 所有入口的 route/listener 测试，单独点名 Gemini `/v1beta/models/*`；rate/concurrency 与 pre-provider DB 拒绝均断言无 Provider/RAG 调用，流返回后 lease 仍在，body 完成/cancel 后删除。heartbeat failure 不得产生后续 attempt、failover 或 breaker 更新，并分别验证响应提交前 503 与提交后协议内服务不可用终态。reaper 单飞、`unref`、多实例分工与 Gateway close 等待顺序有自动化断言。

Rollback point: 管理配置与 DB 状态可保留；回滚调用点即可恢复旧请求行为。

## Step 6: Add Four Quota Meters And Strict Settlement

1. Chat 在 parse 后计算 reservation，`streamChat` 外层 finally 读取最终 usage 并结算；流式成功终止帧等待 settlement，tools fallback、route/key retry 共享 handle。
2. Image 只新增 `n` 的 `1..10` 整数校验，按 `n` 预留、按实际 images 结算；`size/response_format` 保持现有兼容行为。
3. TTS 共用 code-point validator，保留 4096 输入上限并在 Provider 开始后按输入单位结算；`response_format` 保持现有兼容行为。
4. STT 加入 `music-metadata@11.14.0`，使用 `parseBuffer(buffer, { mimeType }, { duration: true })` 执行内容格式识别、duration 解析和整秒取整；同步 Core/Gateway dependency 与 lockfile。
5. 扩展 `IRUsage`、adapter outcome、telemetry 与 DB 映射，使成功媒体用量可查询；治理事务仍独立于 best-effort telemetry。
6. Engine 在首个真实 adapter invocation 前严格标记 Provider started；rejected attempt 与重试不得重复写治理状态。

Verify: 四模态 success/failure/cancel/missing usage/overage/replay 矩阵，损坏与伪造音频在 Provider 前拒绝，Gateway ESM bundle 可加载 parser。

## Step 7: Full Verification And Independent Review

1. 运行 Core/Web/Gateway/observability 定向测试和真实 PostgreSQL governance suite。
2. 运行 `pnpm install --frozen-lockfile`，复核 lockfile 只包含预期依赖变化。
3. 运行 `pnpm check` 与 `pnpm test`。
4. 运行 `pnpm build` 与 `pnpm build:gateway`；若启动服务做 listener/browser 验证，结束前关闭全部进程。
5. 运行 `git diff --check`，检查迁移、snapshot、JSON、日志/指标标签与敏感信息边界。
6. 独立复核 PRD/design/spec compliance、Endpoint Matrix、事务锁序、取消/超时/重试和测试真实性；注入 policy/admission/renew/settle PostgreSQL 故障，断言治理错误不会触发额外 Provider、failover 或 breaker 更新；修复后重复全部受影响门禁。

## High-Risk Files And Review Points

- `packages/core/src/lib/gateway-governance/**`：双主体原子性、统一锁序、DB 时钟、policy fingerprint、quota 差额、reaper/finalize 单赢家与租约删除幂等。
- `packages/core/src/lib/gateway-execution/engine.ts`：严格 Provider-start hook 不得被 best-effort wrapper 吞掉，治理 abort 不得污染 breaker/failover。
- `packages/core/src/lib/protocols/handler.ts` / `encoders.ts` / `stream.ts`：lease ownership、terminal cleanup、四协议 envelope 与 tools fallback 单次结算。
- `packages/core/src/http/v1/{models,mcp,image-generations,audio-speech,audio-transcriptions}.ts`：matrix 覆盖、验证顺序、Retry-After 与 request.signal。
- `packages/core/src/lib/providers/multimodal/**`：媒体单位、实际结果和 AI SDK signal。
- `packages/db/src/schema.ts` / `drizzle/pg/**`：追加迁移、UTC/非负 CHECK、索引锁、journal/snapshot 连续。
- `apps/gateway/src/server.ts`：reaper 启停与关闭顺序，不能在 DB 关闭后遗留在途清理。
- `apps/web/src/app/(dash)/admin/settings/**`：管理员鉴权、整组校验、无嵌套卡片、窄屏与 i18n。
- `packages/observability/src/index.ts`：仅低基数 label，不加入任何身份或 route/model 标签。
- `packages/core/package.json`、`apps/gateway/package.json`、`pnpm-lock.yaml`：纯 ESM 依赖和 Gateway direct dependency。

## Explicitly Deferred

- IP/设备/WAF、连接接收前限流和分布式排队。
- session 鉴权的 `/api/*` 请求并入 API Key 治理。
- 用户/单 Key 覆盖、套餐、计费货币或 Provider 价格换算。
- 改变父 Key 禁用语义或补 `parentId` 完整性。
- 为治理状态增加长期逐请求历史表；长期执行/用量保留归后续观测增长任务。
- 与计量可靠性无关的 Image/TTS 格式字段兼容性收紧。
