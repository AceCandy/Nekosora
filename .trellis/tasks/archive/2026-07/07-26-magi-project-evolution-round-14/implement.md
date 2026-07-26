# Implementation Plan

1. 将 `saveEmbedding` 原样提取到顶层声明 `"use server"` 的 `src/app/(dash)/admin/settings/actions.ts`，只导出异步 action 并由 `ModelConfigSection` 导入；先用静态检查和现有聚焦测试确认只是测试边界调整。
2. 新增 `settings/actions.test.ts` 的 foreign Provider 回归测试，只 mock数据库、会话、缓存和框架边界，实际使用设置服务；确认未接入属主校验时设置被覆盖且测试失败。
3. 新增 `src/lib/providers/ownership.ts`，把现有 `requireOwnedProvider` 的 `providerId + ownerUserId` 查询和“服务商不存在”错误原样提取。
4. 让 `admin/actions.ts` 的四个既有调用点导入共享 helper，删除文件内实现；运行现有 `admin/actions.test.ts`，确认查询谓词、事务和公共模型协作行为不变。
5. 在 `saveEmbedding` 中对非空 Provider ID 调用共享 helper，并确保调用发生在 `upsertSettings`、`resetEmbeddingConfig` 和 `revalidatePath` 之前；空 ID 保持清空语义。
6. 补齐 owned、foreign、missing 与 `provider_id === ""` 测试，通过真实 helper 和设置服务验证写入/保留/清空行为，并断言统一错误与缓存/页面刷新副作用；确认回归测试转绿。
7. 更新 `.trellis/spec/backend/gateway-routing.md` 的管理端 Provider 授权场景，纳入系统设置引用和 Embedding 测试契约。
8. 运行聚焦测试、lint、typecheck、全量测试、生产构建和 `git diff --check`，逐入口复核共享 helper 使用范围与授权顺序。
9. 按 `trellis-check` 质量门禁完成独立复核，检查同类入口审计、测试是否能捕获删除 owner 条件/删除 action 校验、空值兼容、模块依赖方向和范围外行为未被改变。

## Validation Commands

- `pnpm exec vitest run 'src/app/(dash)/admin/settings/actions.test.ts' 'src/app/(dash)/admin/actions.test.ts'`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## Risk And Rollback Points

- 新测试不得 mock 共享 helper 或 `upsertSettings`；settings 与既有 admin action 测试都必须真实执行 owner-scoped 查询，防止共享 helper 内的 SQL 谓词退化。
- foreign/missing 拒绝必须发生在设置写入、缓存清理和页面 revalidate 之前；失败后的任何副作用都视为未修复。
- `provider_id === ""` 不得执行 Provider 属主查询，但 `upsertSettings` 仍会正常取得数据库连接并执行取消配置；仅含空白的非空值不做 trim。
- helper 接受 db/transaction 对象，不能在内部另取连接，否则会破坏 `createModel` 事务内授权边界。
- 共享模块不能反向 import `app/`；若出现循环依赖或必须引入新运行时依赖，应退回规划重新评估。
- 不修改 schema 或 Embedding 运行时契约；若实现需要 owner 设置字段、数据迁移或 enabled/protocol 行为变化，应拆为后续任务。

## Completion Gate

- 所有非空 Embedding Provider ID 在首个副作用前通过共享 owner-scoped helper。
- foreign/missing Provider 无设置、缓存或页面刷新副作用，且错误不枚举。
- 空值清理、owned Provider 保存和既有模型/路由授权行为保持不变。
- 同类生产入口审计无新增遗漏，授权规范已同步。
- 独立复核无阻塞项，全部自动化门禁通过。
