# 模型配置统一为多路由（个人模型对齐全局）

## Goal

把「我的配置 · 模型」(BYO) 从当前的 1:1 直挂（一个模型固定绑一个 provider 的一个上游模型）升级为**多路由架构**，与「全局配置 · 模型」同构：一个个人模型可挂多条上游路由，网关按 priority/weight 选择并故障转移。作用域仍限于本人（userId 隔离），不改变「个人 vs 全员」的可见性边界。

## Background

- 全局模型走「逻辑模型 + 多路由」四表路由器（`global_models` / `global_providers` / `global_routes`），网关 `resolveGlobalRoutes` 按 priority 分组、weight 加权抽取、熔断过滤。
- 个人模型当前是 1:1 直挂：`user_models` 行上直接写 `providerId` + `upstreamModelName`，无 routes 概念；网关 `resolveByoRoute` 返回单元素数组，priority/weight 硬编码，且不参与熔断。
- 两套是独立表（`user_*` vs `global_*`），靠 userId 隔离，非同表。
- 详见 `research/` 下三份调研。

## Requirements

1. **多路由能力**：个人模型支持挂多条上游路由，每条路由独立配置 provider / upstreamModelName / priority / weight / enabled；1 模型多路由，可增删改、启停。
2. **模型元信息对齐**：个人模型补 `displayName` / `vendor` / `systemPrompt` / `description` 字段，与全局模型表单体验一致。**不补** `accessScope`（个人模型本就 userId 私有，internal 语义不适用）、不补 `icon` / `sortOrder`（个人模型量少用不上）。
3. **网关行为对齐**：个人模型请求走 priority/weight 选择 + 熔断过滤，与全局一致；持续故障的个人 provider 会被熔断。
4. **数据迁移**：升级时为每条已存在的 `user_models` 用其 `providerId` / `upstreamModelName` 补种 1 条 `user_routes`（priority=0, weight=1, enabled=true），保证旧个人模型仍可用。迁移幂等、覆盖全量。
5. **前端同构**：「我的配置 · 模型」的列表列、模型表单、可展开路由面板、路由级测试，与「全局配置 · 模型」一致。

## Constraints

- 双 schema 同步：`pg.ts` 与 `sqlite.ts` 必须同步加表/扩列，并各生成一份 `0003_*.sql` 迁移。
- userId 隔离贯穿所有新 actions：写/改/删/查都复合 `and(eq(userId, user.id))`，在 SQL WHERE 层强制归属校验。
- 不触碰全局表，回归面最小。
- `user_models.providerId` / `upstreamModelName` 旧两列本期保留标遗留、分步下线（网关与新建逻辑不再读它们，但列暂不删，避免迁移风险）。
- 迁移必须先于网关逻辑切换完成，否则旧模型会 `no_route`。

## Acceptance Criteria

- [ ] 个人模型可创建/编辑/删除/启停多条路由；priority/weight 在网关选择中生效。
- [ ] 个人模型表单含 displayName / vendor / systemPrompt / description。
- [ ] 网关请求个人模型时，多条路由按 priority/weight 故障转移；持续故障的个人 provider 被熔断跳过。
- [ ] 升级后，原有 1:1 的旧个人模型仍可正常调用（迁移补种了路由）。
- [ ] `testMyRoute` 可测单条路由；userId 隔离生效（无法操作他人的模型/路由）。
- [ ] `pg.ts` / `sqlite.ts` 双 schema 的 `0003` 迁移幂等，bootstrap 自动应用成功。
- [ ] 「我的配置 · 模型」与「全局配置 · 模型」的列表/表单/路由面板/测试交互一致。

## Out of Scope

- 不合并 `global_*` 与 `user_*` 表（回归面过大）。
- 不给个人模型加 accessScope / icon / sortOrder。
- 不改子 key 绑定机制（`key_model_bindings` 按 userModelId 绑模型不绑路由，本期零改动）。
- 不改全局模型/路由任何逻辑。
