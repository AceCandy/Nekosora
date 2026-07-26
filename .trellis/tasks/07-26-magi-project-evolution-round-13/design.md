# Technical Design

## Boundary

改动限定在 `src/app/(dash)/admin/actions.ts` 的管理端授权边界和 `actions.test.ts` 的回归测试。数据库 schema、路由解析、前端表单与公开 Server Action 签名均不改变。

## Authorization Model

- 模型和路由的管理权继续由 `assertModelManageable` / `assertRouteManageable` 决定：公共资源允许任意管理员管理，私有资源仅属主可管理。
- Provider 始终是私有资源。新增一个文件内私有辅助函数，按 `providerId + ownerUserId` 单次查询当前管理员拥有的 Provider；未命中统一抛出“服务商不存在”。
- 辅助函数接受当前数据库或事务对象，使 `createModel` 能在原事务内完成 Provider 校验，并供 `createRoute`、`updateRoute`、`attachProviderModelRoute` 复用。
- Provider 的 `ownerUserId` 不提供更新入口；校验与后续写入之间若 Provider 被并发删除，现有外键会拒绝写入，不会形成跨属主授权绕过。

## Data Flow

```text
createModel(providerId)
  -> requireAdmin
  -> transaction
  -> requireOwnedProvider(tx, providerId, admin.id)
  -> insert model + initial route

createRoute/updateRoute/attachProviderModelRoute(providerId)
  -> requireAdmin
  -> assert model/route manageable
  -> requireOwnedProvider(db, providerId, admin.id)
  -> insert/update route

testRoute(routeId)
  -> requireAdmin
  -> assertRouteManageable(db, routeId, admin.id) and return route
  -> load referenced provider
  -> parse key + probe
  -> update circuit breaker
```

## Contracts

- `requireOwnedProvider` 的查询必须同时包含 `providers.id = providerId` 与 `providers.ownerUserId = admin.id`，不能先全局查 ID 再在应用层分支返回不同错误。
- `assertRouteManageable` 返回已授权的路由行；现有调用方可忽略返回值，`testRoute` 复用它以避免授权后再次全局查询路由。
- `createModel` 的 Provider 校验位于现有事务内。失败抛错触发整个事务回滚，不能留下没有合法初始路由的半成品模型。
- `createRoute` 与 `updateRoute` 在任何数据库写入前完成 Provider 属主校验。
- `testRoute` 在读取 `apiKeysEnc`、调用 `parseKeyBundle`、`pickWeightedKey`、`probeProviderKey`、`recordSuccess` 或 `recordFailure` 前完成路由授权。
- 公共模型跨管理员协作时，调用者只能选择自己拥有的 Provider；运行时仍可按公共模型路由使用该 Provider。

## Validation Matrix

| 入口 | 目标模型/路由 | Provider | 结果 |
| --- | --- | --- | --- |
| createModel | 新建 own model | own | 创建模型和初始路由 |
| createModel | 新建 own model | foreign | 抛错，事务无写入 |
| createRoute | own private model | own | 创建路由 |
| createRoute | manageable public model | own | 创建路由 |
| createRoute | manageable model | foreign | 抛错，不写入 |
| updateRoute | manageable route | own | 更新路由 |
| updateRoute | manageable route | foreign | 抛错，原值不变 |
| attachProviderModelRoute | manageable model | own/foreign | 保持现有成功/拒绝语义 |
| testRoute | own private 或 public route | referenced | 正常探测 |
| testRoute | foreign private route | referenced | 授权失败，无密钥或网络副作用 |

## Compatibility And Trade-Offs

- 选择复用文件内授权辅助函数，不新增领域层模块；四个入口共享相同谓词，避免再次出现漏校验。
- 不给运行时路由解析补 Provider owner 条件。公共模型的合法路由允许模型属主与 Provider 属主不同，运行时按路由使用 Provider 是既有设计；授权必须发生在管理端建立或修改关联时。
- 不改变公共路由可被任意管理员管理和探测的既有策略，只阻止未授权私有路由与未授权 Provider。

## Rollback

变更仅涉及 TypeScript 授权逻辑、测试和对应规范，无迁移或数据转换。回滚工作提交即可恢复旧行为；已存在的非法跨属主路由数据不在本轮自动清理范围内。
