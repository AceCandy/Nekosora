# MAGI 项目进化第 24 轮

## Goal

关闭禁用用户仍可通过 Web session 或 API key 使用系统，以及生产环境以弱默认管理员凭据启动、必需环境变量未在启动阶段校验的安全缺口。

## Background

- `getSession`/`requireSession` 当前返回用户状态但不拒绝非 active 用户。
- `auth.ts` 未把自定义 `user.status` 注册为 Better Auth additional field；当前缺字段时还默认成 active。
- Better Auth session cookie cache 最长 5 分钟，普通 `getSession` 可绕过数据库中的最新状态。
- `verifyKey` 当前只检查 API key 自身是否启用，不检查 key 所属用户状态。
- `validateEnv` 已定义但未接入 Next.js Node runtime 与 worker 启动入口。
- 数据库 bootstrap 与独立 seed 脚本在未配置 `SEED_ADMIN_PASSWORD` 时使用公开默认密码。

## Requirements

- Better Auth 必须把 `status` 注册为服务端只读 additional field；缺失、未知或非 active 状态均不得授权。
- Web session 必须在共享 `getSession` 边界绕过 cookie cache 读取权威状态，避免各业务路由重复判断。
- API key 候选查询必须联表约束所属用户 active，保持每次网关鉴权只有一次候选查询。
- 管理员禁用用户后，既有 session 与 enabled API key 不得继续授权请求。
- 仅在空库确实需要创建首管理员时解析 seed 凭据。生产环境必须拒绝缺失、空值或公开默认密码；非生产保留现有开发默认值。
- 必需环境变量必须在 Next.js Node runtime 和独立 worker 执行业务初始化前校验；Edge 构建不得静态引入 Node-only 依赖。
- 新增回归测试覆盖 disabled session、disabled key、生产 seed 配置及两个启动入口。
- 不修改用户状态枚举、API key 格式、管理员 UI 或数据库结构。
- 不处理 provider 超时、熔断器、请求体 schema 或前端交互；它们进入后续轮次。

## Acceptance Criteria

- [ ] Better Auth 权威 session 结果包含服务端只读 `status`；缺失、disabled 或未知状态在共享鉴权边界返回未授权。
- [ ] 非 active 用户的 enabled API key 无法通过 `verifyKey`，active 用户行为保持不变。
- [ ] 生产空库缺少显式 seed 管理员密码、配置空值或公开默认值时均在账号创建前失败；已有用户和非生产兼容路径保持。
- [ ] Next.js Node runtime 与 worker 在数据库/队列初始化前执行环境校验，Edge 路径不加载 Node-only 初始化。
- [ ] 相关单测、`pnpm check`、全量测试与生产构建通过。

## Out Of Scope

- 主动吊销或删除 Better Auth session/API key 数据；本轮以每次鉴权读取当前用户状态为准，重新启用后原数据恢复可用。
- 修改管理员禁用交互、状态枚举或新增审计事件。
- 其他 round-19 候选问题。
