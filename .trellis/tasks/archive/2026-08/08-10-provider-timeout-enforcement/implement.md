# Provider 超时强制执行实施计划

## Success Gate

- PRD 三类语义、默认值、范围和不可禁用策略全部落地。
- 所有 Consumer Matrix 路径存在真实执行层消费者和针对性测试。
- timeout、caller cancel、response committed、fallback、breaker 与 telemetry 行为符合设计。
- PostgreSQL SQL/journal/snapshot、管理 UI/Action/i18n、Core runtime 同步。
- `pnpm check`、`pnpm test`、`git diff --check` 和独立复核通过。

## Step 1: Lock Policy With Failing Tests

1. 新增 Provider timeout policy 单测：默认值、范围、表单解析、空白、毫秒精度、`0`/越界、首个 signal reason 和清理。
2. 扩充 error policy/Engine 测试：timeout 必须是 `gateway.timeout` failed attempt；caller abort 仍是 interrupted；覆盖提交前 fallback、提交后停止和单次 finalize。
3. 为 admin/panel actions、Provider form、Registry/stream、media 与 probe 先补最小失败用例。

Verify: 定向运行新增测试，确认失败原因对应缺失行为而非 fixture 错误。

## Step 2: Add Shared Policy And Database Constraints

1. 实现 `packages/core/src/lib/providers/timeouts.ts`，保持标准 Web API、无新增依赖。
2. 扩充 `ResolvedProvider` 与 routing 映射，保留 nullable/raw 配置并统一解析有效值。
3. 在 Drizzle schema 增加三个 nullable range check。
4. 生成下一条 PostgreSQL 迁移；只追加 SQL/journal/snapshot。迁移先把非法历史值置 `null`，再增加约束。

Verify: policy、routing、schema/migration 定向测试；检查旧迁移未改写。

Rollback point: 此阶段只增加共享契约与兼容约束，尚未改变请求执行行为。

## Step 3: Wire Admin And Panel Configuration

1. admin/panel 的 create/update action 共用表单解析函数；update 通过 marker 区分“旧调用 preserve”和“显式清空为 null”。
2. 两个 Provider page DTO 与 `ProviderItem` 透传三个字段。
3. Provider 弹窗增加响应式秒数输入、原生范围约束、默认提示和清空语义。
4. 同步 `apps/web/messages/en.json` 与 `zh-CN.json`。

Verify: 两套 action 测试、ProviderFormDialog 静态组件测试、JSON 解析与 i18n key 对称检查。

Rollback point: UI/Action 可整体回滚；数据库 nullable 列与约束保持兼容。

## Step 4: Enforce Connect And Total Read Deadlines

1. Registry 四种 Chat/hosted factory 始终安装 shared fetch；保留认证头过滤与 User-Agent 覆盖。
2. Image/TTS/STT factory 接入同一 fetch。
3. Engine 每个 route/key attempt 创建 read scope，将组合 signal 传给 adapter；caller abort 与 read timeout 分流，所有路径释放 scope并非阻塞关闭 iterator。
4. error policy 识别直接/嵌套 timeout，稳定映射 `gateway.timeout`/504/network，并保持凭据脱敏。

Verify: Registry 四协议测试、Engine fake-timer/fallback/commit/cleanup 测试、媒体 adapter 测试。

Rollback point: shared policy 可保留，仅回滚 runtime consumers 即恢复旧执行行为。

## Step 5: Enforce Stream Idle And Probe Budgets

1. Chat streaming 传入 provider `chunkMs`；非流式调用不传 idle timeout。
2. hosted search 用 `min(30s, provider idle)` 替代私有 watchdog，修正 timeout 被误记 interrupted 的问题。
3. raw model/key probe 使用 connect fetch + local read scope；deep probe 增加 read scope 和 stream idle。
4. 所有从持久化 Provider 发起的 discovery/health/model/route probe 传递该 Provider 的显式配置；未保存直测使用默认 policy。

Verify: 可控流 fake-timer 测试覆盖无 chunk、持续 chunk、首 chunk 后停滞、probe 15 秒上限和 signal 清理。

## Step 6: Full Cross-Layer Verification

1. 运行 Core/Web/Gateway 相关定向测试并修复发现。
2. 运行 `pnpm check`。
3. 运行 `pnpm test`。
4. 运行 `git diff --check`，检查迁移 SQL/journal/snapshot、JSON 与敏感信息边界。
5. 独立复核 PRD/design/spec compliance、所有 Consumer Matrix 路径和测试有效性；发现问题后修复并重复门禁。

## High-Risk Files And Review Points

- `packages/core/src/lib/gateway-execution/engine.ts`：caller cancel 与 timeout 首因、iterator close、attempt/finalize 恰好一次。
- `packages/core/src/lib/gateway-execution/policy.ts`：timeout 不得被 Abort/network 通用分支覆盖，raw error 不得越过脱敏边界。
- `packages/core/src/lib/providers/registry.ts`：四协议均安装 fetch，User-Agent 与认证头行为不回归。
- `packages/core/src/lib/stream.ts`、`web-search/hosted-model.ts`：stream idle 重置、commit 和终态顺序。
- `packages/core/src/lib/providers/multimodal/*`：媒体调用继续由 Engine 独占 fallback/telemetry。
- `packages/core/src/lib/providers/probe.ts`：15 秒业务预算与 Provider deadline 组合、body 读取期清理。
- `apps/web/src/app/(dash)/admin/actions.ts`、`panel/actions.ts`：相同 validation、更新 preserve/clear 语义。
- `packages/db/src/schema.ts`、`drizzle/pg/**`：仅追加迁移，journal/snapshot 连续，合法存量不变。

## Explicitly Deferred

- TCP-only transport timeout、Undici dispatcher 或替换 HTTP client。
- 动态按模型类别选择默认 timeout。
- 管理端无限等待开关或每条 Route 覆盖 Provider timeout。
- 客户端 API Key 限流与请求排队治理。
