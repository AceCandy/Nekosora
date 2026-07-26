# MAGI 项目进化第 20 轮

## Goal

修复文件处理进程在 `extracting` 或 `embedding` 阶段退出后永久卡死的问题，使遗留任务能被 worker 自动接管，同时保证旧执行者恢复运行后不能覆盖新执行者的状态或文件块。

## Background

- 第 18 轮已修复并发生成状态竞态与 run 租约投影。
- 第 19 轮已限制 Chat best-effort 审计/用量写入等待，并修复 heartbeat 重叠及取消后续租。
- `processFile` 当前只允许 `pending/error` 原子切换到 `extracting`；进程在 claim 后退出时不会进入 `catch`，记录会永久停留在活动状态，后续调用也无法重新 claim（`src/lib/rag/process.ts:23`）。
- claim 之后的状态更新、chunk 删除和插入只按 `fileId` 写入；若只放开 stale 状态重新 claim，旧执行者可能在新执行者接管后晚写（`src/lib/rag/process.ts:35`、`src/lib/rag/process.ts:84`）。
- 上传队列失败时使用 fire-and-forget fallback；fallback 所在 Web 进程退出后没有持久任务保证再次投递（`src/app/api/upload/route.ts:119`）。
- `file_objects` 当前没有更新时间、租约或 fencing token（`src/db/schema/pg.ts:565`）。
- 现行文件存储规范明确把 stale `extracting/embedding` 恢复排除在原子 claim 契约外（`.trellis/spec/backend/file-storage.md:451`）。

## Requirements

- `file_objects` 必须保存本次处理所有者的随机 fencing token 与数据库时间租约；字段保持 nullable，并为 stale 活动状态扫描提供部分索引。
- `processFile` 必须继续原子 claim `pending/error`，并允许原子接管租约为空或已过期的 `extracting/embedding`；有效租约不得被抢占。
- 租约创建、过期判断和续租必须统一使用 PostgreSQL 数据库时钟，不得依赖应用服务器时钟；长事务最终提交前须以当前 statement 时间再次验证 freshness。
- claim 后的每次文件状态写入必须同时校验 `fileId`、fencing token、活动状态和未过期租约；校验失败后不得继续持久化。
- chunk 删除、批量插入和最终 `done` 更新必须位于同一个短事务中，并在事务开始和最终状态写入时验证所有权；事务超过租约窗口时整体回滚，防止旧执行者污染新结果或留下半批 chunks。
- 长时提取/嵌入期间必须定期续租；调度必须单飞、timer 必须 `unref()`，停止时清理 timer 并等待已开始的续租。
- worker 启动后必须立即并周期扫描 stale 活动记录；扫描本身单飞，多 worker 并发时仍由数据库 claim 决定唯一接管者，关闭 worker 时先停止并等待扫描，再停止队列。
- stale 查询失败不得阻断 worker 启动或永久停止后续周期；单个候选失败不得阻断同批其他候选，并须通过单轮上限、顺序处理和跳过重叠 tick 提供背压。
- 必须保留 unsupported、empty text、embedding unavailable、embedding error、正常完成和普通异常的现有对外状态语义。
- PostgreSQL 迁移必须追加而非改写历史，包含 SQL、Drizzle journal、snapshot 和迁移一致性测试。
- 部署必须先排空不认识 fencing token 的旧 worker/fallback 执行者，再启动带 stale 扫描的新 worker；不得把 nullable 字段误表述为可安全混部。
- 不扫描 `docs/cankao`，不升级 Trellis，不顺带重构无关代码。

## Acceptance Criteria

- [ ] `pending/error` 或 stale 活动记录只能有一个调用者 claim 成功，有效活动租约保持 no-op。
- [ ] 旧 token 在接管后不能更新文件状态、删除或插入 chunks，也不能覆盖新执行者终态。
- [ ] chunk 替换中任一步失败时事务回滚，不暴露半批结果；成功时 chunks 与 `done` 一起提交。
- [ ] 续租使用数据库时间、同一时刻最多一个请求；租约丢失或续租失败后当前执行者停止后续写入。
- [ ] worker 启动扫描能恢复 stale `extracting/embedding`，周期扫描不重叠，关闭会清理 timer 并等待 in-flight 扫描。
- [ ] scanner 查询失败后下个周期仍可重试，单个候选失败不影响同批后续候选，单轮候选数有固定上限。
- [ ] queue 重试在有效租约期间即使 no-op，遗留记录仍能由 stale 扫描恢复；fallback 进程退出也有相同恢复路径。
- [ ] 新迁移包含两个 nullable lease 字段、活动记录回填、部分索引及连续 journal/snapshot，迁移测试通过。
- [ ] 专用临时 PostgreSQL 数据库验证并发 stale claim、旧 token fencing、父行锁串行化和 chunk 事务回滚；验证后临时库被删除。
- [ ] 现有文件上传 fallback、普通文件处理状态和队列生命周期回归测试保持通过。
- [ ] `pnpm check`、全量测试、生产构建、Trellis validate 与 `git diff --check` 全部通过。

## Out Of Scope

- 第 18/19 轮已解决的 run 投影、heartbeat 单飞和 best-effort 有界等待。
- 修改 pg-boss 默认 `retryLimit` / `expireInSeconds`，或新增队列管理界面。
- 为 `extractText` / embedding SDK 增加真正的 AbortSignal 取消能力。
- 新增前端状态、人工重试入口或批量恢复管理功能。
- 无实证的预防性重构、新功能扩展或工具链升级。
