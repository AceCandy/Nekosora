# 共享状态与 Key 归属调研

## 共享状态能力

- `packages/core/src/lib/infra/cache.ts:17` 的 Redis 是可选两级缓存；未配置 `REDIS_URL` 时会降级到进程内 Keyv。现有 facade 只暴露 `get/set/delete/wrap`，没有原子 INCR、条件写、Lua 或租约操作。
- `.env.example:19` 与 `packages/core/src/lib/infra/env.ts:18` 均表明 Redis 不是应用启动硬依赖。把治理正确性建立在该缓存上会让未配置 Redis 或 Redis 降级的多实例部署失去一致性。
- PostgreSQL 是必需依赖。仓库已有 Drizzle transaction、`FOR UPDATE`、条件更新、原子 upsert、数据库时钟与带 fencing token 的租约模式，例如 `packages/core/src/lib/rag/processing-repository.ts:242`。

## API Key 归属事实

- `packages/db/src/schema.ts:112` 定义主/子 Key 共用 `api_keys`。每个用户只有一个主 Key；子 Key 的 `parentId` 指向主 Key，但当前没有自引用外键或父类型约束。
- `packages/core/src/lib/keys.ts:151` 的 `verifyKey` 返回稳定的 `userId`、`apiKeyId` 与 `keyKind`，足以构造 Key 和用户两个治理维度；原始 Key 不需要离开鉴权边界。
- 主 Key 禁用不会自动禁用子 Key。父子关系当前只表达组织关系，子 Key 的实际权限由模型绑定限制。本任务不应顺带改变父级禁用语义或补父链外键。
- `gateway_executions` 已保存 `userId`、`apiKeyId` 与 `keyKind`，但不存在限流、并发或配额状态。

## 推荐方案

- PostgreSQL 作为唯一正确性事实源；Redis 不参与原子判定，也不新增 Redis 直连依赖。
- 每个已认证请求同时检查 Key 桶与用户共享桶，任一拒绝即停止。子 Key 不能通过增加数量绕过用户总上限；主 Key 与子 Key 的用户桶相同。
- 管理员配置全局默认值和平台上限；首期不增加用户自助或单 Key 覆盖，避免策略优先级和继承规则膨胀。
- 并发使用唯一 `leaseId` 作为 ownership token，并以数据库 `expiresAt` 条件续租。正常终态立即释放，进程退出或网络异常依靠目标主体收敛与固定小批量全局 reaper 回收；迟到 heartbeat 不能复活过期 lease。
- 速率状态使用 PostgreSQL 原子条件更新和数据库时钟；不能先读后写，也不能使用应用服务器时间计算窗口。

## 风险与边界

- PostgreSQL 不可用时鉴权与路由本就无法可靠工作，治理检查应失败关闭并返回安全的服务不可用错误，不能静默放行。
- 过期租约需有有界清理策略；仅在同一主体下次请求时回收会留下长期孤儿行。
- 指标只能使用 `reason`、`scope`、`operation` 等低基数标签。原始 Key、Key 预览、用户 ID 与 API Key ID 不进入指标标签。
