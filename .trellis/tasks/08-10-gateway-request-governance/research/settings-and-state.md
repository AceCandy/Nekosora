# 管理配置与治理状态调研

## 配置入口

- `packages/db/src/schema.ts:905-915` 的 `system_settings` 是 `(namespace, key) -> text value` 通用 KV，不需要为治理策略新增配置列。
- `packages/core/src/lib/system-settings/service.ts:11-67` 提供读取和逐键 upsert，但没有类型/范围校验，批量写入也不是原子事务。治理策略适合保存为一个版本化 JSON 值，由共享解析器整体验证后单行 upsert，避免部分更新。
- `apps/web/src/app/(dash)/admin/settings/page.tsx:19-72` 与 `SettingsTabs.tsx:5-22` 已有设置 Tab 模式。首期新增管理员治理 Tab，复用 `requireAdmin`、Server Action、revalidate 与中英文 i18n；不增加用户或单 Key 覆盖入口。
- 运行时对缺失值采用代码默认策略。管理端越界输入整组拒绝；数据库中出现损坏 JSON 时回退到同一套受限代码默认值并产生低基数错误指标，不能静默切换为无限制。数据库读取失败仍失败关闭。
- 速率主体不能用 `updated_at` 直接判断策略变化：时间戳不保证每次更新唯一。对校验后的有效 policy 生成 canonical fingerprint，可让同值保存保持余额、真实策略变化重置 refill 状态。

## 稳定性参数

- 仓库现有 Chat/RAG 租约均采用 2 分钟 TTL、30 秒 heartbeat。治理租约沿用 120 秒 TTL 与 30 秒续租周期，使用 PostgreSQL 时钟。
- TTL 与续租周期保持内部常量，不开放管理员修改。它们是正确性参数，不是业务配额；动态化会增加每请求读取、SQL interval 与错误配置风险。

## PostgreSQL 状态

- Redis/Keyv 只有可降级缓存语义，不能参与正确性判断。速率、月额度、请求账本和租约都以 PostgreSQL 为唯一事实源。
- 速率采用每主体一行的 token bucket 状态，以数据库时间补充令牌；Key 与 user 两行按稳定顺序加锁，在同一事务内检查和消费，任一失败则全部回滚。
- 月额度按主体、计量种类与 UTC month start 保留独立窗口行，分开保存 `reserved_units` 与 `used_units`；Chat token、Image count、TTS code point、STT second 不混用单位。
- 一个活动治理租约行保存唯一请求 ID、user/API Key 主体、operation、可选的单种 reservation、Provider 是否已开始与租约到期时间。并发通过未释放且未过期的租约行计数；同一行也是 finalize 幂等锁点，避免另建重复 settlement 表。
- 过期租约自动退出并发计数。Provider 未开始的孤儿 reservation 退款；Provider 已开始但缺失终态的 reservation 转入 `used_units` 后删除租约，迟到 finalize 因租约不存在而 no-op，不能再次调整用量。
- 所有会同时触碰 lease 与 subject 的事务都必须先按稳定顺序锁 lease。过期回收与 finalize 依靠同一 lease 行锁选出唯一结算者，并按 lease 保存的月份调整窗口；全局清理一次事务只处理一个过期 lease，避免批量跨主体反向锁。

## 迁移与测试依据

- 新治理表需要 PostgreSQL 迁移、Drizzle journal/snapshot、索引与非负 CHECK；`system_settings` 本身无需改表。旧部署无配置行时由代码默认值决定行为。
- 可复用 `gateway-execution/observability-migration.test.ts`、`providers/provider-timeout-migration.test.ts` 的迁移三件套检查，以及现有 PostgreSQL 并发测试的隔离数据库模式。
- 必须用真实 PostgreSQL 证明 Key/user 双桶原子竞争、速率补充、UTC 月切换、并发租约续期/过期、结算重放、Provider 开始前退款和开始后保守结算；mock 单测不能替代这些一致性断言。
