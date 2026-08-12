# API Key 数据路径加固设计

## 1. 边界与事实

本任务只处理三条已确认的数据路径：

1. 鉴权：原始 Key -> legacy/current prefix 候选查询 -> 常量时间 hash 比较 -> `CallContext`。
2. 展示：登录用户 -> `listKeys` -> Server Component 追加模型绑定 -> Client Component。
3. Key 类型：master 不受模型绑定限制；sub 按自己的 Key ID 查询 `key_model_bindings`。

`parentId` 不参与以上任一授权或生命周期判断，因此移除关系不改变产品行为。

## 2. 方案

### 2.1 鉴权索引

- 在 `api_keys.key_prefix` 上增加普通 B-tree 索引，名称固定为 `api_keys_key_prefix_idx`。
- 保持 `verifyKey` 的 legacy/current 两种等值候选、`enabled=true`、owner `status=active` 和最终 `safeEqual` 不变。
- 在隔离 PostgreSQL 中写入至少 20,000 条具有高选择性 prefix 的 Key，执行 `ANALYZE api_keys` 后运行 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`。
- 递归检查 JSON 计划中的 `Index Name`；接受 `Index Scan`、`Index Only Scan` 或 `Bitmap Index Scan`，但必须引用 `api_keys_key_prefix_idx`。不得用 `enable_seqscan=off` 强迫命中。

不引入额外缓存、前缀格式变更或 hash 查询旁路。

### 2.2 展示 DTO

- `listKeys` 改为显式字段投影，只返回页面实际使用的 `id`、`name`、`keyPrefix`、`kind`、`enabled`。
- `getBindableModels` 只查询 `id`、`name`、`displayName`；页面在最终 Client props 边界再次构造这三个字段，模型 `systemPrompt`、`description`、owner 和时间戳不进入 RSC payload。
- DTO 由 Core Key 模块定义并导出；页面和 Client Component 仅复用类型，不再用类型断言掩盖运行时多余字段。
- `verifyKey` 继续读取鉴权所需的完整存储记录，`keyHash` 只留在服务端鉴权边界。
- 测试以含 `keyHash` 和 `parentId` 的底层假数据执行真实 `listKeys/getMyKeys` 返回链，并对可序列化结果及 `KeysManager` props 做运行时断言，不能只依赖 TypeScript 类型。

### 2.3 移除父子关系

- `createMasterKey` 与 `createSubKey` 不再写入 `parentId`。
- 从内部记录类型、Drizzle schema、`api_keys` 表和 `api_keys_parent_idx` 中移除 `parentId`。
- 继续要求创建子 Key 时存在同用户的启用主 Key；继续使用 `kind + apiKeyId + key_model_bindings` 限制子 Key。
- 不改变禁用主 Key后子 Key仍可独立使用的现有行为。

不增加自引用外键、触发器、复合约束或级联规则，因为它们没有对应的运行时授权语义。

## 3. 迁移与兼容

新增一份 PostgreSQL 迁移并同步 Drizzle journal/snapshot：

1. 删除 `api_keys_parent_idx`。
2. 创建 `api_keys_key_prefix_idx`。
3. 删除 `api_keys.parent_id`。

Web、Gateway、Worker 都在启动时执行同一迁移。旧版本的 `verifyKey` 会全列读取 `api_keys`，因此删列迁移与旧实例不兼容，采用维护窗口一次性发布：

1. 停止外部写流量，并将 Web、Gateway、Worker 实例全部停止；不得先启动携带新迁移的任一服务。
2. 从编排平台确认三个服务实例数均为零，再查询 `pg_stat_activity`；除迁移/管理连接外，不得存在目标数据库应用会话。部署工单必须保存查询结果。
3. 记录 `api_keys` 总行数与 `parent_id IS NOT NULL` 行数。非零表示本次会丢弃已确认无授权语义的旧关系元数据，不单独阻断迁移，但必须与本次 B 方案审批记录对应。
4. 创建可恢复 schema、数据和 `drizzle.__drizzle_migrations` 的一致性数据库备份，记录备份 ID、当前应用提交与迁移账本尾项；维护窗口前必须在隔离数据库完成一次恢复校验，并在部署工单填写实际恢复命令或托管平台恢复步骤。
5. 使用新制品单独执行 `PGOPTIONS='-c lock_timeout=5s -c statement_timeout=30min' pnpm --filter @nekusora/web db:migrate:pg`，只允许一个迁移进程运行。
6. 命令超时或失败时保持服务停止；先核对迁移账本、`parent_id`、两个索引和 Key 行数，再决定解除锁后重试或执行备份恢复，禁止直接盲目重跑。
7. 在保持流量关闭的情况下验证迁移账本、列/索引、Key 行数、legacy/current Key、DTO 序列化和查询计划。
8. 启动全部新版本实例，确认 Web、Gateway、Worker 健康后再恢复流量。

普通 `CREATE INDEX` 和删列需要表锁。执行前检查 `api_keys` 行数、表大小与活动写入，选择可接受的维护窗口；本任务不把 `CREATE INDEX CONCURRENTLY` 塞入当前事务型 migrator。

## 4. 回滚

- 迁移前失败：保持服务停止，直接回滚应用制品。
- 迁移后、恢复流量前失败：执行部署工单中已演练的恢复命令或托管平台恢复步骤，恢复迁移前的一致性数据库备份。该备份同时恢复原始 `parent_id` 数据、索引和 Drizzle 迁移账本；核验 Key 行数、`parent_id`、`api_keys_parent_idx` 和账本尾项后再启动旧制品。
- 恢复流量后发现问题：不得用旧快照覆盖新写入，优先发布前向修复。确需临时运行旧制品时，先人工增加 nullable `parent_id text` 与 `api_keys_parent_idx`，并以 `BOOTSTRAP_SKIP_MIGRATE=1` 启动；这只恢复二进制兼容，不恢复原父子元数据，也不是完整回滚。
- 禁止手工删除或改写 Drizzle 迁移账本来伪造降级；完整回滚以一致性备份为准。

## 5. 验证矩阵

| 场景 | 预期 |
|---|---|
| legacy `前8…` Key | 命中候选并通过 hash 校验 |
| current `前8****后4` Key | 命中候选并通过 hash 校验 |
| disabled Key 或非 active 用户 | 返回 null，且不更新 `lastUsedAt` |
| `listKeys` | 只查询并返回五个展示字段 |
| 底层假数据含 `keyHash/parentId` | `getMyKeys` 序列化结果和 `KeysManager` props 均不包含两字段 |
| 绑定模型含 `systemPrompt/description/ownerUserId` | 查询结果与 `KeysManager` props 只含 `id/name/displayName` |
| 已执行 0010 且 sub 行含非空 `parent_id` | 执行 0011 后 Key 行及业务字段保留，关系列被删除 |
| sub Key 调未绑定模型 | `model_not_bound` |
| sub Key 调已绑定模型 | 正常解析路由 |
| master Key | 不受模型绑定限制 |
| 新代码 + 新 schema | 创建、列表、鉴权正常 |
| 旧代码 + 新 schema | 禁止进入该组合；维护窗口必须先停止全部旧实例 |

## 6. 取舍

- 保留 master/sub 类型，因为它承载真实权限差异。
- 删除 `parentId`，因为它只表达未被系统执行的层级关系。
- 使用数据库原生索引和显式字段投影，不增加缓存、DTO 映射框架或新依赖。
- 选择一次性维护窗口而非保留废弃列；接受短暂停机，以换取同一任务内完成物理收缩。
