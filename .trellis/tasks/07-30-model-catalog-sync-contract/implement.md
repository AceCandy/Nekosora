# Model Catalog Sync Contract Execution Plan

## Phase 0: Baseline And Scope Lock

- [x] 保存 clean worktree、迁移链、当前 dry-run 统计和官方证据；确认不运行 bulk import / direct apply。
- [x] 运行现有 sync/reasoning/model-catalog 定向测试，记录重构前基线。
- [x] Gate：当前数据影响限定为两条官方确认 capability 修正，无 schema/业务数据清理。

## Phase 1: Contract Tests First

- [x] 在 `sync-pi-models.test.ts` 先加入 decoder presence/map rejection、match authority、升降、reference preserve、原子 bundle、deterministic plan 测试。
- [x] 加入 CLI arg/source policy 和 stable safe error 测试；旧 import/apply flags 必须失败。
- [x] 加入 SQL operation 测试，证明只消费 accepted changes、保留无关 JSON key、只在变更时刷新 updated_at，重复执行语义幂等。
- [x] Verify：新增测试先以预期原因失败，旧测试继续描述需要保留的 fixed/runtime 契约。

## Phase 2: Pure Planner Refactor

- [x] 重构外部 decoder，保留 missing/false/true 并输出稳定 rejection codes。
- [x] 重构 matcher，输出 provider/modelKey/kind/authority，禁止 aggregate/tail 进入 accepted changes。
- [x] 引入 reasoning bundle normalizer/validator，删除局部 map fallback 和空串 coercion。
- [x] 让唯一 `CatalogSyncPlan` 同时驱动 diff 与 SQL；递归稳定序列化并排序所有结果。
- [x] 删除 missing-import/canonical grouping/import-upsert 等不再可达的代码与测试。
- [x] Verify：`pnpm exec vitest run src/lib/sync-pi-models.test.ts src/lib/reasoning.test.ts`。

## Phase 3: CLI And Migration-Only Write Path

- [x] 将脚本收缩为 source IO + DB read + plan render + migration write。
- [x] 删除 `--import-missing`、`--also-update`、`--apply`、隐式 cache/fallback 和重复 buildMatchedUpserts。
- [x] `--write` 要求本地 snapshot，记录 digest，未知 flags/live write 固定失败；所有关闭走 finally。
- [x] 更新 README 操作顺序与 package script 示例。
- [x] Verify：dry-run 同 snapshot 两次输出相同；失败输出不含 raw error、URL、路径、payload 或 stack；工作树无 cache/temp。

## Phase 4: Catalog Data Migration

- [x] 用已审 snapshot 生成下一条 PG migration、journal 和 snapshot。
- [x] 人工审查 SQL 只更新 `glm-5.2` 与 `kimi-k2`，使用 JSONB delete/patch 保留无关 capability。
- [x] 更新 `model-catalog.test.ts` 断言 migration targets、操作形状、journal idx/tag/time 和 snapshot prevId。
- [x] 在隔离临时 PostgreSQL 完整迁移，重复执行最新 SQL，断言目标最终值、其他 key、行数和 FK 引用不变；结束时删除临时库。
- [x] Rollback point：migration 未应用前可删除本 child 生成的三个产物；已应用后只写 forward fix。

## Phase 5: Full Consumer Chain

- [x] 在 `reasoning.test.ts` 覆盖目录降级后的 levels/default/modelId stale state/clamp/compatible body。
- [x] 验证 GLM reasoning body 不变且 vision consumer 读取降级；验证 Kimi 不发送 thinking 参数。
- [x] 运行 sync、reasoning、model-catalog、chat context/routing/provider translation 相关定向测试。
- [x] Gate：catalog -> Chat -> state -> clamp -> request body 全链只消费 catalog capability。

## Phase 6: Quality, Spec And Independent Review

- [x] 运行 lint、typecheck、全量 tests、build 和 PostgreSQL gate。
- [x] 更新/新增 model catalog sync spec，修正 pi/官方资料优先级与 migration-only CLI 契约。
- [x] 独立进行实现审查、测试审查、迁移/数据审查、隐私审查和 spec drift 审查；主代理逐项核验证据。
- [x] 检查 diff、git status、cache/temp、schema 范围和敏感信息；关闭所有调试进程。
- [x] 提交产品代码、规格与 task 记录，归档 child，更新父路线图到 4/5。

## Validation Commands

```bash
pnpm exec vitest run src/lib/sync-pi-models.test.ts src/lib/reasoning.test.ts src/lib/model-catalog.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

PostgreSQL gate 使用任务内的隔离数据库流程，不对开发库直接执行 `--apply`。
