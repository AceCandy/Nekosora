# 权限与生产启动安全研究

## Web Session

- `src/lib/session.ts:15-30` 映射 `status` 但不拒绝 disabled，缺字段还默认 active。
- `src/auth.ts:65-71` 启用 5 分钟 Better Auth cookie cache。
- Better Auth `getSession` 支持 `query.disableCookieCache`；其 stateful session 文档明确权威操作应绕过 cookie cache。
- `src/auth.ts` 当前没有 `user.additionalFields.status`，Better Auth schema 只组合显式 additional fields 与插件字段。
- `getSession` 有 21 个调用方，`requireSession` 有 99 个调用方；修复必须集中在共享边界。

## API Key

- `src/lib/keys.ts:138-166` 只按 prefix 查 key、constant-time 比对 hash、检查 key enabled，然后更新 lastUsedAt。
- `CallContext` 由所有 `/v1/*` 网关入口信任，所属用户状态必须在 `verifyKey` 内完成。
- 项目已有 Drizzle table join 查询模式，可用 `innerJoin(user, and(user.id=apiKeys.userId, user.status='active'))` 保持一次读取。

## Startup And Seed

- `src/lib/infra/env.ts:29-49` 已集中校验 encryption key、auth secret 与 database URL，但无调用方。
- `src/instrumentation.ts` 在 Node 分支动态 import process guards 与 bootstrap；变量路径是 Edge 构建约束。
- `src/worker.ts` 在 `startWorker` 开头动态加载 queue 和所有 handler，适合在这些 import 前校验。
- bootstrap 与 `src/db/seed.ts` 都复制公开密码 `change-me-on-first-login`。
- bootstrap 先查询是否存在任意用户，故 seed 密码策略应在该查询之后触发，避免已有用户部署承担无关配置。

## Test Landscape

- 当前没有 session、keys、env 或 instrumentation 专项测试。
- `src/worker.test.ts` 已有完整启动/关闭调用序列，可加入 validateEnv mock 与顺序断言。
- `src/lib/infra/db/bootstrap.test.ts` 已 mock 空/非空 user 查询，可保留已有用户兼容回归；纯 seed 配置函数更适合穷举环境矩阵。
- 生产 build 是 instrumentation Edge 依赖边界的必要门禁。
