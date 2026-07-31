# Chat SSE 显式终态协议

## Goal

修复认证 Chat 在生成失败、中断、启动失败、持久化失败或异常断流时只有 `error`/EOF、前端却无法确认业务终态的问题。内部 `/api/chat` 必须在数据库 outcome 已收敛后发送可机读 terminal，前端只能依据该 terminal 判定本轮成功或可恢复中断，不能把 `[DONE]` 或普通 EOF 当作成功。

## User Outcome

- 失败或中断的 assistant 不再被当前页面当作完整回答。
- 正常成功仍保留 run metadata；部分回答在失败或中断后保持可继续生成。
- 连接在缺少终态时断开会显示为协议/网络异常，而不是静默结束。

## Confirmed Facts

- `src/lib/chat/completion-coordinator.ts` 已返回 `ChatCompletionOutcomeKind`，并在同一完成事务后区分 committed success、failed、interrupted、启动失败和持久化失败；本任务不需要重做数据库终态。
- `src/app/api/chat/route.ts` 当前只在 `finish` 事件后发送 `[DONE]`；失败和中断最终仅关闭 stream。
- `src/features/chat/model/sse.ts` 当前遇 `[DONE]` 直接返回，遇 EOF 也正常返回，没有 terminal latch。
- `src/features/chat/store/chatStreamStore.ts` 的错误帧只追加错误文本；send/regenerate/edit 没有协议级终态映射，continue 在 parser 正常返回后无条件标记 success。
- 消息持久化状态有 `success/interrupted`，而 `runs.status` 才是 success/failed/interrupted 的终态事实源；failed/interrupted 消息当前都持久化为 `interrupted`，用于继续生成。

## Requirements

- R1. 内部 Chat SSE 新增 `{type:"terminal",status:"success"|"failed"|"interrupted"}`；route 只根据 `executeChatCompletion` 已返回的 outcome 映射，不根据是否有文本、是否出现 error 或连接状态重新推断。
- R2. 正常可写的响应固定以 `terminal` 后紧跟 `[DONE]` 收尾；`[DONE]` 只表示传输帧完整结束，不再表示业务成功。客户端已取消或 controller 不可写时仍禁止补写。
- R3. `committed_success` 映射 success；`start_failed`、`committed_failed`、`persistence_failed` 映射 failed；`committed_interrupted`、`cancelled_before_start` 映射 interrupted。成功仍必须先有现有 `finish` metadata。
- R4. SSE parser 必须验证 terminal status，并返回明确结果。`[DONE]` 前缺 terminal、success terminal 前缺 finish、或 EOF 前缺 `[DONE]` 均视为协议异常；未知事件保持向前兼容，畸形 JSON 不得伪造终态。
- R5. send、regenerate、editAndResend、continueGeneration 四条 Store 路径必须消费同一 terminal 结果：success 标记消息 success；failed/interrupted 标记消息 interrupted；客户端主动 Abort 继续由本地 stop 路径立即标记 interrupted。
- R6. error 帧继续承载用户可读失败信息，terminal 不复制原始错误。delta buffer 必须在追加错误和设置终态前同步 flush，避免正文/错误顺序回归。
- R7. 不新增 message enum、不修改 completion transaction、run 终态、历史消息投影或数据库 schema。实时消息状态继续与刷新后的 `success/interrupted` 投影一致。
- R8. 不改变公开 `/v1/*` OpenAI SSE wire；只修改认证 WebChat 的内部 `/api/chat` 及其唯一前端消费者。

## Acceptance Criteria

- [x] 成功响应顺序为 `finish -> terminal(success) -> [DONE]`，前端返回 success 并保留 metadata。
- [x] committed failed/start failed/persistence failed 响应为既有 error（若 transport 可写）后 `terminal(failed) -> [DONE]`，前端消息为 interrupted，不能落入 success 分支。
- [x] 非客户端取消的 committed interrupted 响应为既有 error 后 `terminal(interrupted) -> [DONE]`；客户端主动取消保持零后续写并由本地状态标记 interrupted。
- [x] `[DONE]` 无 terminal、success terminal 无 finish、terminal 后 EOF 无 `[DONE]`、普通 EOF 无 terminal 均被 parser 拒绝。
- [x] send、regenerate、editAndResend、continueGeneration 都只在 terminal success 时标记 success；非成功状态保留已生成正文并保持继续生成语义。
- [x] route、SSE parser、Store 定向测试覆盖 success/failed/interrupted/异常 EOF，既有 cancel 与 delta/error 顺序测试保持通过。
- [x] lint、typecheck、全量 Vitest 与 production build 通过；`/v1/*` 相关回归测试不受影响。

## Key Decisions

- 保留 `finish` 作为仅成功 metadata 事件，新增 `terminal` 作为所有业务终态事件，`[DONE]` 退回纯传输哨兵职责。
- terminal 由 route 根据 coordinator 的返回 outcome 编码；coordinator 不新增第二套终态状态机。
- 不增加数据库 `failed` message status。失败类型由 run/terminal 表达，message status 继续表达“完整或可继续”，避免实时与刷新语义分裂。
- 本项目尚未上线，不保留缺 terminal 的旧内部协议兼容分支；旧前端会忽略 terminal 并继续识别 `[DONE]`，公开 API 不变。

## Out Of Scope

- 修改 completion transaction、run lifecycle、Gateway execution、Provider failover 或 memory intent。
- 新增失败重试按钮、重做 ChatMessage 操作区或改变继续生成产品语义。
- 数据库迁移、历史数据回填或 message status enum 扩展。
- 修改公开 `/v1/*` 流式协议。

## Data Impact

无数据库或持久化数据变更。回滚时 route、parser 和 Store 必须作为同一个内部协议单元回滚。
