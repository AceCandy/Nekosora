# Technical Design

## Boundary

改动限定在共享 Provider 属主校验、Embedding 设置 Server Action、对应回归测试和授权规范：

- 新增 `src/lib/providers/ownership.ts`，成为 owner-scoped Provider 解析的唯一实现。
- `src/app/(dash)/admin/actions.ts` 删除文件内重复实现并导入共享 helper，既有调用点和签名不变。
- 新增顶层声明 `"use server"` 的 `src/app/(dash)/admin/settings/actions.ts`，只导出异步 `saveEmbedding(formData)`。
- `ModelConfigSection.tsx` 改为导入该 action，不改变 `EmbeddingConfigForm` props、字段或 UI。
- 新增 `settings/actions.test.ts`，并继续运行既有 `admin/actions.test.ts` 守住 helper 的真实查询谓词。

数据库 schema、设置键、运行时 Embedding 读取、Provider 生命周期和前端交互均不改变。

## Authorization Contract

共享 helper 的目标签名：

```ts
requireOwnedProvider(
  db: unknown,
  providerId: string,
  ownerUserId: string,
): Promise<{ id: string }>
```

- 使用调用方已取得的 db 或 transaction 对象，查询 `providers.id = providerId AND providers.ownerUserId = ownerUserId`。
- 不分别报告“存在但不属于你”和“不存在”，两者统一抛出 `Error("服务商不存在")`。
- 不在 helper 内调用 `requireAdmin()`；身份认证属于 Server Action 边界，helper 只解析已知 owner 的资源。
- 不增加 enabled/protocol 条件，保持第 13 轮所有现有调用点的授权语义；这些有效性约束属于独立生命周期问题。

## Data Flow

```text
saveEmbedding(formData)
  -> requireAdmin()
  -> parse provider_id + trimmed model
  -> provider_id === ""?
       yes -> skip resource lookup (preserve clear behavior)
       no  -> getDb()
              -> requireOwnedProvider(db, providerId, admin.id)
  -> upsertSettings("rag", embedding keys)
  -> resetEmbeddingConfig()
  -> revalidatePath("/admin/settings")
```

授权失败必须在 `upsertSettings`、缓存清理和页面重新验证之前抛出。运行时 `loadConfig` 只消费已经在设置边界建立的 Provider 引用，本轮不在消费侧引入无法确定 owner 的重复授权。

## Test Design

1. 先把现有嵌套 action 原样移到独立模块，保持行为不变并建立直接测试入口。
2. 新增只 mock数据库/会话/缓存/框架边界的 foreign Provider 回归测试，实际使用设置服务；在 owner 校验接入前，动作会继续覆盖设置，因此测试必须呈红。
3. 接入共享 helper 后验证：
   - owned ID：经真实 owner resolver 与设置服务写入 trim 后配置，随后清缓存并 revalidate；
   - foreign 与 missing ID：真实 owner-scoped 查询无结果，统一错误，原设置及缓存副作用保持不变；
   - `provider_id === ""`：Provider owner resolver 不调用，设置服务仍按既有方式取得数据库连接并清空配置。
4. 新 settings 测试与现有 admin action 测试共同证明 helper 执行真实 `id + ownerUserId` 条件，并保持事务及公共模型协作语义。

## Compatibility And Trade-Offs

- 选择共享 helper 而非在 settings 内复制查询，因为授权谓词已出现第二个生产模块；集中实现能让错误语义与未来修复同步传播。
- 选择独立 settings action 模块而非通过渲染组件捕获嵌套 action；前者遵循现有 `{feature}/actions.ts` 约定，测试依赖更少，也不需要渲染 RSC。
- 保留精确空字符串 ID 的清空语义；仅含空白的值沿用现有非空行为并在查询时拒绝，避免悄然扩大输入归一化规则。
- 不在 helper 增加 `server-only` marker。项目无既有约定，且所有导入方已经是服务端模块；新增依赖不为核心目标提供额外可验证收益。
- 不修改运行时 `embedding.ts`。它没有当前保存者/owner 上下文，直接补 owner 条件需要新增持久化契约或改变全局设置模型，超出本轮范围。

## Rollback

无数据库迁移或数据转换。回滚工作提交即可恢复原嵌套 action 与文件内 helper；新增模块和测试可随同删除。部署前已存在的异常设置不会被本轮迁移或自动修正。
