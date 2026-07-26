# MAGI 项目进化第 14 轮

## Goal

修复 Embedding 系统设置对客户端提交的 `provider_id` 缺少属主校验的问题，防止管理员把其他管理员的私有 Provider 配置为后台 Embedding 上游，并由后台任务使用对方的密钥和额度。

## Background

- `providers` 是 owner-only 私有资源；管理员身份本身不授权其使用客户端提交的任意 Provider ID。
- `src/app/(dash)/admin/settings/ModelConfigSection.tsx:74-79` 只在页面渲染时展示当前管理员拥有且已启用的 Provider，但该下拉过滤可以被直接提交伪造的 `FormData` 绕过。
- `src/app/(dash)/admin/settings/ModelConfigSection.tsx:107-118` 的 `saveEmbedding` 仅执行 `requireAdmin()`，随后把未经资源授权的 `provider_id` 写入全局 `system_settings`，并清理 Embedding 缓存。
- `src/lib/rag/embedding.ts:37-72` 读取该全局 Provider ID 后只按 ID 查找 Provider，随后解析 `apiKeysEnc` 并构造 Embedding 客户端；因此伪造值会形成真实的跨管理员密钥使用链路。
- 第 13 轮已在 `src/app/(dash)/admin/actions.ts:92-100` 建立 `providerId + ownerUserId` 的非枚举校验，但它仍是文件内函数；Embedding 成为第二个生产消费者后，应提取并复用同一授权契约。
- 生产源码审视未发现除 `saveEmbedding` 外另一处同类的“客户端 Provider ID -> 全局设置 -> 后台读取密钥”遗漏入口。

## Requirements

- 对非空 `provider_id`，`saveEmbedding` 必须在写入 `system_settings`、清理缓存或触发页面重新验证前，确认 Provider 同时满足 `providers.id = providerId` 与 `providers.ownerUserId = admin.id`。
- Provider 不存在或属于其他管理员时统一抛出“服务商不存在”，不能向调用方泄露资源是否真实存在；失败路径不得写设置、清缓存或重新验证页面。
- `provider_id === ""` 时继续沿用现有清空语义，不执行 Provider 属主查询，并由 `upsertSettings` 删除对应设置；仅含空白的非空值仍按现有行为进入查询并被拒绝。
- 将第 13 轮文件内 `requireOwnedProvider` 提取到 Provider 领域的共享服务端模块，并让既有管理端模型/路由入口与 Embedding 设置入口复用同一查询谓词和错误语义。
- 为 Embedding 保存动作建立独立、可直接导入测试的 Server Action 边界；页面表单字段、action 调用签名和成功后的缓存清理/页面重新验证行为保持不变。
- 回归测试必须分别覆盖 owned、foreign、missing 和精确空字符串 Provider ID，并证明授权失败发生在所有持久化及缓存副作用之前；既有管理端 Provider 关联测试继续验证共享 helper 的真实 owner-scoped 查询。
- 更新 `.trellis/spec/backend/gateway-routing.md` 的 Provider 授权规范，使系统设置中客户端提交的 Provider 引用也受同一资源授权契约约束。

## Acceptance Criteria

- [x] 当前管理员提交自己拥有的非空 Provider ID 时，Embedding 设置正常写入，随后调用 `resetEmbeddingConfig()` 并重新验证 `/admin/settings`。
- [x] 分别提交其他管理员和不存在的 Provider ID 时均抛出“服务商不存在”，且 `upsertSettings`、`resetEmbeddingConfig` 和 `revalidatePath` 均未调用。
- [x] 提交 `provider_id === ""` 时不执行 Provider 属主查询，仍按现有语义清空设置并刷新缓存与页面。
- [x] `createModel`、`createRoute`、`updateRoute` 和 `attachProviderModelRoute` 继续通过共享 helper 拒绝 foreign Provider，既有成功与公共模型协作行为不变。
- [x] 新增测试在缺少 `saveEmbedding` 属主校验时能够失败，并覆盖授权发生在设置写入和缓存副作用之前。
- [x] 聚焦测试、lint、typecheck、全量测试、生产构建和 `git diff --check` 通过，独立复核未发现同类遗漏入口或授权顺序回归。

## Out Of Scope

- 把全局 `system_settings` 改成按管理员或租户存储，或改变“最后一次保存全局生效”的既有产品语义。
- 给 Provider 增加共享授权、visibility、RBAC 或新的数据库字段/迁移。
- 改变 Embedding 运行时对 `enabled`、`protocol` 的校验策略，或改变页面 Provider 列表过滤规则。
- 修复 Provider 更新、停用或删除后的 Embedding 缓存失效和悬空设置问题。
- 自动清理部署前可能已写入的非法 Provider ID，或改变 Embedding/RAG/Mem0 的降级行为。
- 修改其他模型配置、网关路由解析、密钥加密、用量归属或前端交互。

## Risks And Deferred Items

- `system_settings` 是全局单例；不同管理员合法保存自己的 Provider 时仍会互相覆盖。本轮只修复越权提交，不改变该既有全局配置模型。
- 运行时只按 Provider ID 读取且带进程内缓存；已存在的异常设置、Provider 禁用/删除或密钥更新后的缓存一致性需要后续独立任务处理。
- 把嵌套 Server Action 移到独立模块会改变模块边界但不改变公开表单协议；生产构建用于验证 Next.js Server Action 打包兼容性。
- 本轮不使用真实 PostgreSQL 多管理员数据或真实上游密钥做集成验证，主要依赖 owner-scoped 查询测试和副作用顺序断言。
