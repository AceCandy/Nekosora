# 用量日志副任务区分与统计页打磨

## Goal

用量统计页 6 项改进：区分 chat 后台副任务（标题/记忆/压缩）日志、筛选区刷新按钮、时间精度到秒、错误表去掉冗余「详情」列、错误日志补 httpStatus。

## Background

- **双日志问题（Q2）**：标题生成 / 记忆抽取 / 摘要压缩三个副任务复用 `streamChat`/`generateChat`，其 `finally` 兜底各写一条 `source=chat` 的 usage 日志，与主回复混在一起，用户难以分辨。已用库数据印证（同一分钟多条 chat 记录，短输出即副任务）。
- **缓存不命中（Q1，本任务不动）**：经库数据确认非 bug——近期全 0 是切换到 ZEN-AI/硅基/火山等第三方中转 provider，上游不回吐 `cached_tokens`；历史 `global` provider 命中过（glm-5.2 max 4352）。`cacheWrite` 永远 0 是 `usage.ts:83` 硬编码。
- 其余 Q3/Q4/Q5/Q6 为统计页可用性 / 信息密度打磨。

## Requirements

### R1. chat 副任务区分字段（Q2）
- usage_logs（+ ops_error_logs 对称）新增 `task_kind` 列（nullable text）。
- 主回复 / 网关请求 = `null`；副任务 = `title` / `memory` / `compact`。
- 前端用量明细表 / 错误表中能区分出副任务（徽标或标识）。

### R2. 统计筛选区刷新按钮（Q3）
- 用量明细 + 错误请求的筛选栏提供「刷新」入口，点击后重新拉取服务端数据（无需 F5）。

### R3. 时间精度到秒（Q4）
- `formatDateTimeLocal` 输出含秒，用量明细 + 错误表 + 详情抽屉一致生效。

### R4. 错误表去掉「详情」列（Q5）
- ErrorLogsTable 整行已可点击进详情，移除冗余的「详情」按钮列，colSpan 同步调整。

### R5. 错误日志补 httpStatus（Q6）
- stream.ts 主生成路径（streamChat / generateChat）失败落库时补 `httpStatus`，使错误表 HTTP 状态列对生成类失败也有值。

## Constraints

- 双 dialect（pg / sqlite）schema 对齐；pg 需生成 migration。
- usage_logs / ops_error_logs 双表对称新增 `task_kind`（nullable，兼容历史行）。
- **不改 errorCode 字面值**：保护已有 ops_error_logs.error_code 数据 + error-classify 的短码/点分码双收录。
- DESIGN.md 合规（莫兰迪灰调 / 零投影 / 无彩色粗条）。
- 副任务字段为 nullable 新列，可安全回滚。

## Out of Scope

- Q1 缓存命中（provider 上游能力，不改代码）。
- 副任务从统计聚合口径排除（本期仅加字段 + 明细区分，不改统计数字）。
- `cacheWrite` 细分（依赖 AI SDK v5，留后续）。

## Acceptance Criteria

- [ ] usage_logs / ops_error_logs 双表、双 dialect 均有 `task_kind` 列；pg migration 已生成
- [ ] 标题/记忆/压缩副任务落库 task_kind 分别为 title/memory/compact；主回复与网关请求为 null
- [ ] 用量明细表可区分副任务；错误表对副任务失败亦可见
- [ ] 筛选栏有刷新按钮，点击重新拉取数据
- [ ] 时间显示含秒（明细 / 错误 / 详情抽屉一致）
- [ ] 错误表无冗余「详情」列，colSpan 正确，空表占位正常
- [ ] stream.ts 生成类失败落库带 httpStatus，错误表状态列对生成失败有值
- [ ] `pnpm check`（lint + typecheck）通过
