# 网关调用日志重构

## Goal

参考 sub2api：把网关调用日志改成**物理双表**（`usage_logs` 仅成功计费 + 新建 `ops_error_logs` 错误请求），补全 TTFT / 错误码 / 错误信息 / HTTP 状态码 / 可读服务商名 / 路由名，覆盖网关 + WebChat + admin 后台 + panel 用户端，前端「正常用量明细 / 错误请求」分 Tab，用户端脱敏。

## Background

现状只有一张 `usage_logs` 表，WebChat 聊天与网关 `/v1/*` 调用混存，靠 `source` 字段区分。已确认的缺口：

- **首 token / TTFT 完全缺失**：`runs.firstTokenLatencyMs` 是孤儿空壳表，无任何代码读写；stream 流程也未采样首 token 时刻。
- **错误信息落库丢失**：`logUsage` 形参有 `errorCode`，但 `usage_logs` 表无对应列、insert 未写 → 失败原因无法事后排查。
- **上游服务商不可读**：`providerRef` 存裸组合 ID（`global:<id>` / `byo:<id>`），前端原样输出，没 JOIN 取可读 `name`。
- **无路由维度**：完全没有 routeId / routeName / 真实上游模型名，无法回溯「这次调用走了哪条路由」。
- **状态非 HTTP 码**：`status` 是 `success/failed/interrupted` 枚举，无数字 HTTP 码。
- **正常 / 错误未分开**：失败请求混在用量表里，无独立入口、无筛选、无分页、无详情；admin 用量页写死 `limit(20)`。
- **两套错误模型**：网关用 `usage_logs.status`，聊天用 `messages.errorCode/errorMessage`，互不关联。

## Scope（已确认决策）

| 维度 | 决策 |
|---|---|
| 表结构 | **物理双表**（照搬 sub2api）：`usage_logs` 只存成功计费，新建 `ops_error_logs` 存失败 / 中断 |
| 调用来源 | 网关 `/v1/*` + WebChat 聊天（两者共用日志表） |
| 前端覆盖 | admin 后台 + panel 用户端「我的用量」都改 |
| 首 token | 本期一起做（改 stream 流程采样） |
| 参考项目 | `docs/cankao/sub2api`（Go+Vue，借鉴设计思路，非照抄代码） |

## Requirements

### R1. 数据模型（物理双表）

- `usage_logs` 收敛为「成功且计费」语义：保留现有 token / 用户 / 模型 / 耗时列，**新增** TTFT、可读服务商名、路由名、真实上游模型名、HTTP 状态码。
- 新建 `ops_error_logs`：记录失败 / 中断请求，至少含用户、来源、模型、真实上游模型、可读服务商名、路由名、请求路径、是否流式、HTTP 状态码、错误码、错误信息、错误阶段、错误类型、端到端耗时、TTFT、时间。
- 允许存**脱敏后**的请求摘要（请求路径、模型、参数概要），**严禁**存完整请求体 / 响应体 / 凭证 / Authorization 头。
- pg 与 sqlite 双 dialect schema 对齐。

### R2. 写入链路

- 成功请求落 `usage_logs`；失败 / 中断请求落 `ops_error_logs`（不再用 `usage_logs.status=failed` 混存）。
- TTFT 在 stream 流程采样首 token 时刻，成功 / 失败双落；非流式 generate 场景 TTFT 定义明确（落 `null` 或等同于首响应）。
- 可读服务商名、路由名、真实上游模型名在路由解析后透传，写入时**快照**（日志是历史记录，provider 改名不影响历史）。
- 覆盖全部写入点：chat（stream.ts）、images、audio speech / transcriptions。

### R3. admin 后台

- 用量页改为双 Tab：**用量明细**（`usage_logs`）/ **错误请求**（`ops_error_logs`）。
- 两个 Tab 都支持筛选（用户 / 模型 / 服务商 / 路由 / 时间区间；错误 Tab 额外 errorPhase / HTTP 状态）+ 分页（替换写死的 limit 20）。
- 错误请求支持详情查看（抽屉 / Modal），展示错误码 / 错误信息 / 阶段 / 上游信息 / 耗时 / TTFT。
- 服务商、路由列显示**可读名称**（非裸 ID）。

### R4. panel 用户端

- 「我的用量」同步双 Tab。
- 错误请求使用**脱敏视图**：不暴露 apiKey / account / 上游 endpoint / 敏感 header；只展示粗分类 + 模型 + 时间 + 状态。

### R5. 错误分类（参考 sub2api 双维度）

- 错误用两层分类：`errorPhase`（请求生命周期阶段）+ `errorType`（具体类型），再映射成用户友好的粗分类 code。
- 至少区分：auth / routing / upstream / network / internal / rate_limit / quota / invalid_request / other。

## Constraints

- **Drizzle 双 dialect**（pg + sqlite）schema 对齐，迁移可生成（`db:generate:pg` / `db:push:sqlite`）。
- **Better Auth 鉴权**：admin 用 `requireAdmin`，panel 用 `requireSession` + 按 userId 过滤。
- **不破坏现有用量统计聚合**（`usage-aggregate.ts` 的 getTimeSeries / getModelBreakdown / getSourceBreakdown）；聚合应自然只统计成功用量。
- **设计规范「星枢天流」**：管理侧用莫兰迪中性色（高灰度低饱和）；零影子（静止无投影，除 Modal / Dropdown / hover）；禁彩色侧边粗条、禁 Eyebrow 眉标；字号固定 rem。
- **安全**：日志 / 注释 / 示例不暴露凭证；用户端视图严格脱敏白名单。
- 兼容现有 `providerRef` 旧数据展示（历史裸 ID 可降级显示，不报错）。

## Out of Scope（本期不做）

- **重试机制**（sub2api 的 `ops_retry_attempts` 表 + 客户端 / 固定上游重试）。
- **完整 request_body 存储**用于重试（只存脱敏摘要）。
- **TTFT 喂调度器**做账号健康评分 / sticky-escape（sub2api 的一鱼两吃），本期 TTFT 仅落日志。
- **成本计费字段**（sub2api 的 input_cost / output_cost / total_cost 系列），Nekosora 现状无计费，不引入。
- 统一 chat 的 `messages` 错误与网关 `ops_error_logs`（两套模型仍各自独立，本期不合并）。

## Acceptance Criteria

- [ ] 成功请求在 `usage_logs` 可见，含 TTFT、可读服务商名、路由名、真实上游模型名。
- [ ] 失败 / 中断请求进入 `ops_error_logs`（不再混入 `usage_logs`），含 errorCode / errorMessage / httpStatus / errorPhase。
- [ ] TTFT 在流式与非流式场景都正确采样落库（成功 / 失败双落）。
- [ ] admin 用量页双 Tab 可用，支持筛选 + 分页，错误请求可查详情。
- [ ] panel 用户端双 Tab 可用，错误请求脱敏（无 apiKey / account / 上游 endpoint 泄露）。
- [ ] 服务商 / 路由列显示可读名称（非裸 ID）；历史裸 ID 数据可降级显示不报错。
- [ ] 现有用量统计聚合不被破坏（图表 / breakdown 仍正确）。
- [ ] pg + sqlite 双 dialect schema 对齐，迁移可生成。
- [ ] `pnpm check`（lint + typecheck）通过；`pnpm test` 通过；触及 stream / errors / routing 的单测已补 / 更。

## Notes

- `prd.md` 只放需求、约束、验收；技术设计见 `design.md`，执行计划见 `implement.md`。
- 实现事实依据见 `research/impl-facts.md`（research 子代理产出）。
