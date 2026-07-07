# 执行计划：个人模型统一为多路由

按顺序执行，每个环节带验证。技术设计见 `design.md`。

## 1. DB schema 定义

- `pg.ts` + `sqlite.ts` 加 `user_routes` 表定义 + `user_models` 扩 4 列（displayName/vendor/systemPrompt/description）。
- 验证：typecheck 通过；两份 schema 字段名/语义对齐（仅列类型不同）。

## 2. 迁移 SQL

- 生成 `drizzle/pg/0003_*.sql` + `drizzle/sqlite/0003_*.sql`：建 `user_routes` + `user_models` 加列 + 补种（每条 `user_models` → 1 条 `user_routes`，幂等）。
- 验证：dev 启动 bootstrap 自动应用成功；`user_routes` 行数 == 旧 `user_models`(有 providerId) 行数。

## 3. RouteRepository 扩展

- 加 `findEnabledUserRoutes(userModelId)`（join `user_routes`+`user_providers`，enabled 过滤，priority 升序，密钥列 `apiKeyEnc`）。
- 验证：返回正确的 join 结果与排序；enabled=false 的路由/provider 不返回。

## 4. 网关 routing

- 重写 `resolveByoRoute`：查 `findEnabledUserRoutes` → 映射 `ResolvedRoute[]` → `orderRoutes()` + `filterByCircuitBreaker()`。
- 验证：个人模型多路由按 priority/weight 故障转移；持续故障 provider 被熔断跳过；全熔断时降级返回全集。

## 5. panel actions

- 新增 `listMyRoutes` / `createMyRoute` / `updateMyRoute` / `deleteMyRoute` / `toggleMyRoute` / `testMyRoute`（全部 userId 隔离）。
- 改 `createMyModel` / `updateMyModel`（去 providerId/upstreamModelName，加 4 个元信息字段）；`getMyModels` 返回带 routes。
- 删 `testMyModel`（先 grep 确认无其他引用）。
- 验证：他人模型/路由不可操作（userId 越权返回空/拒绝）；`testMyRoute` 探测成功并喂熔断。

## 6. 前端

- `ModelsManager` byo 分支对齐 global（列、路由展开、RouteListPanel）；model 行去测试按钮。
- `ModelFormDialog` byo 字段对齐 global（去 providerId/upstreamModelName）。
- `panel/models/page.tsx` 传 routes + route actions + providers。
- 验证：与 global 页同构；建模型 → 加多条路由 → 启停 → 路由级测试。

## 7. 全链路

- 验证：迁移后旧 1:1 模型仍可调用；新建多路由模型故障转移 + 熔断生效；userId 隔离贯穿。
- typecheck + lint 通过。

## 验证命令

- `pnpm typecheck`（或项目实际类型检查命令，执行时确认 package.json scripts）
- `pnpm lint`
- `pnpm dev` 启动，观察迁移日志

## 回滚点

每个环节独立可回滚：schema/迁移可写 down；网关可回退 `resolveByoRoute` 旧逻辑并忽略 `user_routes`；actions/前端可 revert。`user_models` 旧两列本期保留，是天然的安全网。
