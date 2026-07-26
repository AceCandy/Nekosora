# Implementation Plan

1. 扩展 `src/app/(dash)/admin/actions.test.ts` 的内存数据库桩，支持本轮涉及的事务、插入、更新和探测副作用断言。
2. 先补失败回归：覆盖 `createModel`、`createRoute`、`updateRoute` 使用 foreign Provider，以及 `testRoute` 访问 foreign private route；确认写入、密钥解析、探测和熔断副作用均未发生。
3. 在 `admin/actions.ts` 增加文件内 `requireOwnedProvider`，统一 `providerId + ownerUserId` 授权与非枚举错误。
4. 将 `createModel`、`createRoute`、`updateRoute`、`attachProviderModelRoute` 接入共同 Provider 属主校验；保持各自事务、返回值和公共模型协作语义。
5. 让 `assertRouteManageable` 返回已授权路由，并让 `testRoute` 在读取 Provider 和密钥前复用该授权结果。
6. 补正向回归：own Provider 可用于 own/private 与 manageable/public 模型；own/private 和 public route 探测保持正常；现有 attach 测试继续通过。
7. 运行聚焦测试并逐入口复核授权发生顺序、失败副作用和错误不枚举语义。
8. 更新 Gateway Routing 规范中的管理端 Provider 关联授权契约，执行 lint、typecheck、全量测试、生产构建和 `git diff --check`。
9. 完成独立复核后提交实现、归档任务、记录 journal，并进入下一轮。

## Validation Commands

- `pnpm exec vitest run 'src/app/(dash)/admin/actions.test.ts'`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## Risk And Rollback Points

- 测试桩必须真实执行 `and(eq(id), eq(ownerUserId))` 条件，不能只断言辅助函数被调用，否则无法守住 SQL 谓词。
- `createModel` 的 Provider 校验必须使用事务对象，失败后模型和路由均不应残留。
- `assertRouteManageable` 返回路由不能放宽现有 public/private 判断；其他调用方忽略返回值时行为应保持不变。
- `testRoute` 的未授权路径必须在 `parseKeyBundle` 和 `probeProviderKey` 前退出。
- 不修改 schema；若实现需要迁移或前端协议变化，应退回规划阶段重新审视。

## Completion Gate

- 所有接受 `providerId` 的管理端模型/路由写入口都执行同一 owner-scoped 校验。
- 任何 foreign Provider 均不能形成新关联或替换现有关联。
- 未授权私有路由不能触发密钥解析、上游探测或熔断器写入。
- 正常公共模型协作、own Provider 和 route probe 行为不变。
- 独立复核无阻塞项，全部自动化门禁通过。
