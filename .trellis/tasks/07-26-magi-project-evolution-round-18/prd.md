# MAGI 项目进化第 18 轮

## Goal

让 Chat 侧栏的“生成中”状态准确反映同一会话内所有仍存活的生成 run，避免任一并发 run 先结束时提前清除状态，并让进程崩溃后的僵尸状态在有限时间内自动失效。

## Background

- `/api/chat` 在流开始时独立写 `conversations.generating=true`，任一成功或异常收尾都会无条件写 `false`，之后才终结当前 run（`src/app/api/chat/route.ts:314`、`:559`、`:589`、`:606`）。
- `startRun` 与 `finalizeRun` 只维护单条 `runs` 记录，现有 run 没有租约或心跳（`src/lib/chat/run-lifecycle.ts:159`、`:186`；`src/db/schema/pg.ts:391`）。
- 侧栏列表和轮询直接读取会话布尔列（`src/features/chat/actions/conversations.ts:93`、`:111`），因此两个并发 run 的完成顺序会造成可见竞态。
- 启动清理会无条件重置所有 `generating=true` 会话（`src/lib/infra/db/bootstrap.ts:679`），多实例部署时会误清其他实例仍在执行的流。

## Requirements

1. `runs` 必须成为生成活动状态的唯一事实源；活动 run 定义为 `status='running'` 且租约尚未过期。
2. 新 run 必须在流开始前获得数据库时间计算的租约，活跃流必须定期续租；租约和心跳写入失败继续遵循 best-effort，不得阻断模型流。
3. 会话列表与轻量轮询必须从未过期的 running runs 动态派生 `generating`，不得再读写 `conversations.generating` 作为活动状态。
4. 任一 run 终结只能影响自身；只要同一会话仍存在另一条有效租约，派生状态必须保持 `true`。
5. assistant、Artifact 等必要收尾持久化完成后，必须先等待当前 run 的终结写入完成或失败收敛，再发送 `[DONE]`；收尾持久化失败仍不得发送 `[DONE]`。
6. 启动流程不得再全量清除会话布尔状态，也不得把其他实例具有有效租约的 run 判为失效。
7. PostgreSQL 迁移必须新增 run 租约字段和活动查询索引，同步 Drizzle journal/snapshot，并为滚动升级中的既有 running rows 提供有限兼容窗口。
8. 保持现有 SSE 事件、消息/Artifact 持久化、run/tool best-effort 审计和中断终态语义不变。

## Acceptance Criteria

- [x] 同一会话 R1、R2 同时运行时，R1 成功、失败或中断均不会让 R2 的 `generating` 提前变为 `false`。
- [x] 最后一条有效 run 终结后，下一次列表或轮询查询返回 `generating=false`。
- [x] fresh running run 返回 `true`；租约过期、租约为空或已终结 run 返回 `false`。
- [x] 心跳使用数据库时间续租，停止流后不再续租；心跳异常不向客户端泄露敏感信息且不抛出到模型流。
- [x] `[DONE]` 仅在消息收尾成功且 `finalizeRun` 已 await 后发送；失败/abort 路径仍终结 run 并清理心跳。
- [x] 新实例启动不会清除其他实例的 fresh run；旧的无租约会话布尔值不再影响 UI。
- [x] `0012` 迁移、journal、snapshot、部分索引和旧 running row 兼容更新均有自动化回归。
- [x] 聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 与 Trellis validate 全部通过。

## Out Of Scope

- 不实现可恢复 SSE、事件重放、run 接管或跨实例流迁移。
- 不新增常驻调度器或分布式锁服务。
- 本轮保留 `conversations.generating` 列用于兼容与回滚，但运行时不再把它作为事实源；删除列另行迁移。
- 不修改 Chat 视觉样式、客户端本地 `streaming` 状态或非 Chat 的图像生成状态。

## Deferred Risk

- 进程崩溃后 run 行可能继续保留 `status='running'`，但租约到期后不会再被视为活跃；将过期 run 物化为 `interrupted` 可在后续审计治理轮次完成。
- 若数据库不可用超过完整租约窗口，活动指示可能暂时消失；数据库恢复后的下一次心跳可恢复租约，模型流本身保持 best-effort 运行。
