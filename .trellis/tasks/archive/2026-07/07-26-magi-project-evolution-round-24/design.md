# 权限与生产启动安全设计

## Problem Statement

用户 `status` 已是数据库中的业务授权状态，但 Web session 和 API key 两条鉴权链都没有把它作为授权谓词。与此同时，Better Auth 未注册该自定义字段且 cookie cache 可返回旧用户快照。生产启动还会在空库使用公开 seed 密码，已有的 `validateEnv` 也没有接入 Node/worker 入口。

## Invariants

1. 用户可用性由 `user.status = 'active'` 唯一表达；未知或缺失状态必须失败关闭。
2. 所有 Web session 消费方通过 `getSession`/`requireSession` 继承同一授权规则，不在业务路由散落判断。
3. API key 自身 enabled 与所属用户 active 缺一不可；disabled 用户不能更新 key 的 `last_used_at`。
4. 生产空库不能创建公开可预测凭据；已有用户的部署不应被无关 seed 配置阻断。
5. 启动环境校验发生在 DB/queue 初始化前，且不能破坏 Next Edge instrumentation 构建。

## Selected Design

### Authoritative Web Session

在 Better Auth 配置中声明 `user.additionalFields.status`：字符串、必填、默认 `active`、`input: false`，使 DB 读取和 session 输出包含服务端管理字段，客户端不能自行写入。

`getSession` 调用 `auth.api.getSession` 时传入 `query.disableCookieCache=true`，强制 stateful PostgreSQL 会话读取当前 user。仅当 status 严格等于 `active` 才映射 `SessionUser`；缺失、disabled、未知值或 API 异常都返回 null。`requireSession` 与 `requireAdmin` 无需新增分支。

不删除 session：禁用通过权威状态立即生效，重新启用后尚未过期的 session 可恢复，保持本轮数据层零破坏和可回滚性。

### API Key Owner Status

`verifyKey` 的 prefix 候选查询从 `api_keys` inner join `user`，join 条件同时匹配 user id 与 `status='active'`。只对 active 用户的候选执行现有 constant-time hash 比较；命中且 key enabled 后才更新 `last_used_at`。这样 valid key 仍只有一次读取查询，disabled/孤儿用户自然无候选。

### Seed Credentials

增加纯函数 seed 凭据解析器，由 bootstrap 和手动 seed 复用，并且只在确认数据库没有用户之后调用。非生产继续使用现有默认账号方便本地启动；生产对 password 缺失、trim 后为空或等于 `change-me-on-first-login` 直接抛出稳定错误。邮箱/名称保持现有默认，密码最小长度继续由 Better Auth 负责。

`.env.example` 不再提供可直接使用的公开密码，README 明确生产必须显式设置。

### Startup Validation

Node instrumentation 在安装进程守卫后，以变量路径动态 import `env.ts` 并调用 `validateEnv`，然后才打印启动信息和动态 import bootstrap。Edge runtime 仍在任何动态 import 前返回。

worker 在导入 queue/RAG/标题模块前调用 `validateEnv`。校验失败直接拒绝 `startWorker`，因为尚未取得 queue，不需要清理资源。生产构建继续作为 Edge 静态依赖边界门禁。

## Compatibility And Rollback

- 无数据库迁移、API 响应格式或前端协议变化。
- active 用户、active key 和非生产 seed 默认行为保持。
- disabled 用户会立即从 Web/API key 两条入口变成未授权，这是预期安全修复。
- 回滚代码即可恢复旧行为；没有删除 session/key 或不可逆数据变更。

## Verification Strategy

- session 单测覆盖 active、disabled、missing/unknown status、auth 异常和权威查询参数。
- key 单测覆盖 active owner 成功、disabled owner/disabled key 拒绝、拒绝路径不更新 lastUsedAt。
- seed 解析器单测覆盖 production missing/empty/public-default 拒绝、production strong 与 development fallback。
- instrumentation 单测覆盖 Edge no-op、Node 校验顺序和校验失败阻断 bootstrap。
- worker 测试断言校验发生在 queue 获取前，失败时不启动/停止 queue。
- 运行 lint/typecheck、全量测试与 production build。

## Risks

- Web session 每次鉴权会读取 PostgreSQL，不再享受 5 分钟 cookie-only 快路径；这是禁用立即生效的必要一致性成本。
- API key 查询新增 user join，但仍为一次查询；现有 `api_keys.key_prefix` 索引缺失是旧候选池的独立性能问题，不在本轮追加迁移。
