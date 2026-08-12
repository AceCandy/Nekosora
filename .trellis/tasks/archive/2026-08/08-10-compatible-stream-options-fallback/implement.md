# Implementation Plan

1. 在 parser 与 `/v1/chat/completions` 路由测试中复现入站 `stream_options` 400，允许并校验 `include_usage`，同时保留未知子字段拒绝行为。
2. 在 policy 测试中覆盖精确 400、嵌套 AI SDK 错误和误判反例，再实现出站 `stream_options` 拒绝检测。
3. 给 `providers` 增加可空能力列，生成 PostgreSQL migration、journal 和 snapshot，并补迁移元数据测试。
4. 把字段接入 `ResolvedProvider` 与 routing；Provider 管理更新时重置为待探测，并补 action/routing 测试。
5. 在 registry 测试中覆盖 `null/true` 默认发送和 `false` 省略，再让构造器读取 Provider 字段。
6. 在 engine 测试中覆盖同 route/key 单次重试、两条 attempt、单次 finalization、breaker 隔离和禁止循环，再实现专用 hook。
7. 在 `streamChat` 接入仅限 `openai-compatible + openai-chat` 的检测与 Provider 条件持久化回调。
8. 运行定向测试、Core/DB/Web 类型检查、相关 ESLint 与 `git diff --check`。
9. 独立复核入站/出站边界、错误匹配范围、并发换址保护、响应提交边界、telemetry 和既有工具降级路径。

## Validation Commands

```bash
pnpm --filter @nekusora/core test -- packages/core/src/lib/stream.test.ts packages/core/src/lib/providers/registry.test.ts packages/core/src/lib/gateway-execution/engine.test.ts
pnpm --filter @nekusora/core typecheck
pnpm --filter @nekusora/db typecheck
pnpm --filter @nekusora/web typecheck
pnpm exec eslint packages/core/src/lib/gateway-execution/policy.ts packages/core/src/lib/gateway-execution/engine.ts packages/core/src/lib/gateway-execution/types.ts packages/core/src/lib/providers/registry.ts packages/core/src/lib/providers/types.ts packages/core/src/lib/repositories/route-repository.ts packages/core/src/lib/routing.ts packages/core/src/lib/stream.ts apps/web/src/app/\(dash\)/admin/actions.ts
git diff --check
```

## Risky Files

- `packages/core/src/lib/gateway-execution/engine.ts`：不能改变普通 key/route 重试、已提交响应和 breaker 语义。
- `packages/core/src/lib/providers/registry.ts`：持久化字段只能影响 OpenAI-compatible Chat 的 `includeUsage`。
- `packages/db/src/schema.ts` 与 `drizzle/pg/meta/**`：SQL、journal 和 snapshot 必须同步。
