# Gateway Execution Engine Implementation Plan

## Preconditions

- [ ] 用户审阅并明确批准 `prd.md`、`design.md`、`implement.md`。
- [ ] 任务通过 `task.py validate`，且 implement/check context manifests 已配置真实条目。
- [ ] `task.py start` 后才允许修改产品代码。

## Phase 1: Characterization Gates

- [ ] 补齐 Chat stream/non-stream 成对 contract tests：key retry、route failover、deterministic failure、Abort、text/reasoning/tool-call commit。
- [ ] 固定 `/v1/chat/completions`、Images、TTS、STT 的 OpenAI SDK wire payload 与错误 envelope。
- [ ] 补齐媒体双 key/双 route 当前失败用例，作为迁移前 red tests。
- [ ] 验证 owner-only/by-id visibility、sub-key binding 与 weighted order 既有测试保持绿色。

验证：

```bash
pnpm exec vitest run src/lib/routing.test.ts src/lib/stream-circuit-breaker.test.ts src/lib/stream-agent-loop.test.ts
pnpm exec vitest run src/app/v1/chat/completions/route.test.ts src/app/v1/images/generations/route.test.ts src/app/v1/audio/speech/route.test.ts src/app/v1/audio/transcriptions/route.test.ts
```

Rollback point：仅测试变更，无生产行为改变。

## Phase 2: Observability Fact Model

- [ ] 在 `src/db/schema/pg.ts` 用 `gateway_executions` / `gateway_attempts` 替换旧日志表定义。
- [ ] 生成追加的 `0001` PostgreSQL migration；人工确认只 drop `usage_logs` / `ops_error_logs` 并创建新对象。
- [ ] 同步 Drizzle `_journal.json` 与 snapshot，补 schema/migration 断言。
- [ ] 新建 execution telemetry repository，覆盖 start/attempt/finalize 的 best-effort 写入和脱敏。
- [ ] 将 usage/error 查询、管理页统计、retry chain 和 typeahead 改读新事实模型。
- [ ] 更新 metrics 命名与 smoke tests；最终 execution 计数和 upstream attempt 计数分离。

验证：

```bash
pnpm exec vitest run src/db/schema/pg.test.ts src/lib/usage.test.ts src/lib/usage-aggregate.test.ts src/lib/repositories/error-log-repository.test.ts
pnpm exec tsx scripts/smoke/metrics.smoke.ts
```

Rollback point：产品入口尚未切 engine；schema 问题使用 forward migration 修复，不承诺恢复旧日志。

## Phase 3: Deep Execution Module

- [ ] 新建 `src/lib/gateway-execution/`，实现 operation、attempt adapter、outcome 和状态机类型。
- [ ] engine 统一 route resolution、key ordering/limit、retry/failover、commit、Abort、breaker 与 telemetry。
- [ ] 用 fake atomic/stream adapters 建立参数化 contract matrix。
- [ ] 删除测试中对 Drizzle/log sink 细节的依赖，interface test 只观察 attempts、events、outcome、breaker 和 telemetry ports。

验证：

```bash
pnpm exec vitest run src/lib/gateway-execution
```

Rollback point：engine 尚未接生产入口，可整目录回滚。

## Phase 4: Chat Adoption

- [ ] 将 `streamChat` 的单次 provider stream 变成 Chat stream attempt adapter。
- [ ] 将 `generateChat` 的 `generateText` 变成 atomic attempt adapter。
- [ ] 保留 `streamChatWithTools` 在 execution module 之外；每轮继续共享同一 runId 并聚合 usage。
- [ ] 删除 `stream.ts` 中重复 route/key loops、attempt logging 和 breaker 编排。
- [ ] 验证 cache、reasoning、structured output、custom UA、TTFT 与 suppress-final-usage 语义。

验证：

```bash
pnpm exec vitest run src/lib/stream.test.ts src/lib/stream-circuit-breaker.test.ts src/lib/stream-agent-loop.test.ts src/lib/reasoning.test.ts
pnpm exec vitest run src/app/v1/chat/completions/route.test.ts src/app/api/chat/route.test.ts
```

Rollback point：保留旧 Chat implementation 到本阶段验收；失败时只切回 Chat adapter。

## Phase 5: Media Adoption

- [ ] 建立 `(operation, protocol)` adapter registry 与确定性不兼容错误。
- [ ] 图像 adapter 使用 engine 的完整 route/key chain，保留 OpenAI Images wire payload。
- [ ] TTS adapter 使用完整 route/key chain，支持 `openai` / `openai-compatible` / `openai-audio-tts`。
- [ ] STT adapter 使用完整 route/key chain，支持 `openai` / `openai-compatible` / `openai-audio-stt`。
- [ ] route 层删除重复的失败日志补写，只负责 auth/body/response 翻译。
- [ ] 覆盖首 key 失败、首 route 失败、adapter 不兼容后下一 route 成功、全不兼容、Abort 与凭据脱敏。

验证：

```bash
pnpm exec vitest run src/lib/providers/multimodal/image-gen.test.ts src/lib/providers/multimodal/audio-adapters.test.ts
pnpm exec vitest run src/app/v1/images/generations/route.test.ts src/app/v1/audio/speech/route.test.ts src/app/v1/audio/transcriptions/route.test.ts
```

Rollback point：按 image / TTS / STT 单独切回旧 adapter；不回滚已通过的 Chat engine。

## Phase 6: Cleanup And Full Verification

- [ ] 删除旧 `logUsage` 分流、旧日志 repository 和所有重复 retry helpers；移除由本任务产生的 unused imports/types。
- [ ] 更新 `.trellis/spec/backend/gateway-routing.md`、logging/error specs 与 README 中相关运维说明。
- [ ] 运行 focused tests 后执行全量 lint、typecheck、tests。
- [ ] 独立 review：检查 commit-before-yield、Abort finally、breaker 顺序、日志清理范围、凭据 seam 和高基数 metrics label。
- [ ] 检查 git diff，确认没有临时日志、导出文件、密钥或调试产物。

验证：

```bash
pnpm check
pnpm test
git diff --check
python3 ./.trellis/scripts/task.py validate 07-29-gateway-execution-engine
```

## Risky Files

- `src/lib/stream.ts`
- `src/lib/routing.ts`
- `src/lib/usage.ts`
- `src/db/schema/pg.ts`
- `drizzle/pg/0001_*.sql`
- `drizzle/pg/meta/*`
- `src/app/v1/**/route.ts`
- `src/lib/providers/multimodal/*`
- usage/operations 管理页及 repositories

## Review Gates

- Gate A：schema migration 明确只清理两张旧日志表。
- Gate B：engine contract matrix 全绿后才接 Chat。
- Gate C：Chat 全绿后才逐个接媒体模态。
- Gate D：所有入口切换且管理页查询完成后才删除旧 implementation。
- Gate E：独立复核和全量验证通过后才提交。
