# Embedding Provider Authorization Research

## Confirmed Data Flow

```text
admin settings 页面
  -> 只展示 enabled=true 且 ownerUserId=admin.id 的 Provider
  -> 客户端提交可伪造的 provider_id
  -> saveEmbedding 仅 requireAdmin
  -> system_settings[rag.embedding_provider_id] 全局写入
  -> resetEmbeddingConfig
  -> 后台 loadConfig 按 Provider ID 全局读取
  -> parseKeyBundle(apiKeysEnc)
  -> Embedding 请求使用对应密钥与额度
```

- UI 列表过滤：`src/app/(dash)/admin/settings/ModelConfigSection.tsx:74-79`。
- 未授权的保存动作：`src/app/(dash)/admin/settings/ModelConfigSection.tsx:107-118`。
- 全局设置读取与 Provider 密钥消费：`src/lib/rag/embedding.ts:37-72`。
- `system_settings` 只有 namespace/key/value，唯一键为 namespace + key，没有 owner 维度：`src/db/schema/pg.ts:747-758`。
- 设置服务按 namespace/key 覆盖全局值，空字符串表示删除：`src/lib/system-settings/service.ts:37-66`。

## Root Cause

- 管理员会话只完成身份认证，不能授权客户端提交的 Provider ID。
- 页面下拉列表的 owner 过滤被误当成资源授权边界；Server Action 可被直接调用并伪造 `FormData`。
- 第 13 轮只在 `admin/actions.ts` 内共享 `requireOwnedProvider`，当时只有同文件消费者；Embedding 设置成为第二个跨模块消费者后，文件内作用域导致同一规则再次遗漏。

## Entry-Point Audit

- `saveEmbedding` 是生产源码中唯一直接把客户端 Provider ID 写入 `system_settings`，并由后台消费者读取 Provider 密钥的入口。
- 同页标题、compact 与 Mem0 LLM 配置提交的是 `model_id`；`assertBackgroundModelId` 会验证 public/enabled 模型、route 和 Provider，不属于直接 Provider ID 设置遗漏。
- 管理端模型/路由写入口已通过 `requireOwnedProvider` 校验；panel Provider/路由入口也按 owner 约束。
- Web Search 的 provider ID 是 per-user JSON 内部 ID，配置和密钥均按 userId 隔离，不引用全局 `providers` 表。

## Shared Helper Decision

推荐把 `src/app/(dash)/admin/actions.ts:92-100` 的文件内函数提取到 `src/lib/providers/ownership.ts`：

```ts
requireOwnedProvider(db: unknown, providerId: string, ownerUserId: string)
```

- helper 只依赖 `drizzle-orm` 与 `@/lib/infra/db`，符合 app -> lib -> infra 的依赖方向，不产生循环依赖。
- 继续接受 db/transaction 对象，保留 `createModel` 在现有事务内授权的行为。
- 查询同时组合 Provider ID 与 owner ID，未命中统一抛出“服务商不存在”。
- 项目没有现成 `server-only` import 约定；调用方均位于服务端模块。本轮不为显式 marker 增加新依赖。
- 在 `saveEmbedding` 内复制查询虽然少一个文件，但会产生第二份安全谓词和错误文案，违反上一轮明确的防复发结论。

## Test Boundary

- 当前 `saveEmbedding` 是 `ModelConfigSection` 内嵌 Server Action，没有独立导出，也没有对应测试。
- 推荐先把原行为无修改地移到 `src/app/(dash)/admin/settings/actions.ts`，在模块顶层声明 `"use server"`，由组件导入并继续传给 `EmbeddingConfigForm`；该模块只导出异步 Server Action，便于 Vitest 直接调用。
- 新增 `src/app/(dash)/admin/settings/actions.test.ts`，只 mock 数据库、会话、Embedding 缓存和 Next 页面重新验证等系统边界；测试实际贯穿 `saveEmbedding -> requireOwnedProvider -> upsertSettings`，不 mock 项目内部授权 helper 或设置服务。
- foreign 与 missing 测试分别让真实 owner-scoped 查询无结果，并通过实际设置读取证明原值未改变，同时断言缓存清理、页面重新验证均未发生；若保存动作未调用 helper，这些测试会覆盖设置并失败，能够捕获当前漏洞。
- owned 测试通过真实 helper 与设置服务写入，再从设置读取接口验证 Provider ID 和 trim 后的模型值，缓存与 revalidate 仅作为系统边界断言。
- 精确空字符串 ID 测试断言 Provider 属主查询未发生，继续通过真实 `upsertSettings` 取得数据库连接并执行清空语义；仅含空白的值不视为空。
- `settings/actions.test.ts` 与既有 `src/app/(dash)/admin/actions.test.ts` 都实际执行 `id + ownerUserId` 谓词，避免测试只守住 helper 调用形状而未守住 SQL 条件。

## Deferred Findings

- 全局设置允许不同管理员合法地覆盖彼此的 Embedding 配置；这是现有产品语义，不在本轮改成 per-owner。
- `loadConfig` 不检查 Provider enabled/protocol；保存时只补 owner 校验无法完整解决这些独立有效性问题。
- Provider 更新、停用、删除不会重置 Embedding 缓存；已缓存的 baseUrl/key 可能继续使用到显式保存或进程重启。
- Provider 被删除后全局设置可残留悬空 ID；已有异常或恶意设置也不会由本轮自动清理。
- 上述问题应按独立数据模型与缓存生命周期任务处理，不能混入本轮授权修复形成不可验证的范围扩张。

## Break-Loop Analysis

### 1. Root Cause Category

- **Category**: C - Change Propagation Failure，伴随 B - Cross-Layer Contract、D - Test Coverage Gap 与 E - Implicit Assumption。
- **Specific Cause**: Provider owner-only 契约已存在，但第 13 轮的 resolver 只在 `admin/actions.ts` 文件内共享；Embedding 设置作为第二个生产消费者时没有可导入的统一边界，页面 owner 过滤再次被隐式当作授权。

### 2. Why Earlier Protection Was Incomplete

1. 第 13 轮正确修复了模型/路由入口，但当时没有跨模块生产消费者，文件内 helper 的作用域不足以让后续 settings action 复用。
2. 既有测试覆盖模型/路由关联，没有直接调用 Embedding 保存动作，因此无法证明伪造 `FormData` 会在设置写入前失败。
3. 运行时按全局设置读取并解密 Provider 是预期消费路径；只审查运行时查询会误把问题定位到消费侧，真正缺失的是设置写入边界授权。

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | 把 `requireOwnedProvider` 提取到 `src/lib/providers/ownership.ts`，供所有跨模块消费者复用。 | DONE |
| P0 | Test coverage | 通过真实 owner resolver 与设置服务覆盖 owned/foreign/missing/empty，并断言失败无缓存或页面副作用。 | DONE |
| P0 | Documentation | 扩展 `backend/gateway-routing.md` 的 7 段授权契约，纳入系统设置 Provider 引用。 | DONE |
| P1 | Systematic audit | 审视所有客户端 Provider ID -> 后台密钥消费入口，确认本轮无第二个遗漏。 | DONE |
| P1 | Review checklist | 沿用 cross-layer guide 中“UI Filtering Is Treated As Resource Authorization”检查项。 | DONE |

### 4. Systematic Expansion

- **Similar Issues**: 本轮生产入口审计未发现其他直接把客户端 Provider ID 写入全局设置并由后台解密密钥的路径。
- **Design Improvement**: 安全谓词出现第二个生产模块时立即提升为领域 helper；调用方仍负责认证和副作用顺序，helper 只负责 owner-scoped 资源解析。
- **Process Improvement**: 资源 ID 授权审查必须沿完整数据流从表单写入追到密钥/网络消费者，并验证失败发生在持久化、缓存、revalidate 等首个副作用前。

### 5. Knowledge Capture

- [x] 共享 Provider owner resolver 已建立并被现有五类入口复用。
- [x] Gateway Routing code-spec 已包含 Embedding settings 的签名、矩阵、测试和错误契约。
- [x] Cross-layer guide 已有对应思考检查项，无需重复追加。
- [x] Provider 生命周期与全局设置模型问题保留为独立后续候选，不与本轮授权修复混合。
