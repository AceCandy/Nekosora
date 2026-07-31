# 修复 Chat execution telemetry 终态未收敛

## Goal

确保 WebChat 在 finish、错误和中断后完成 gateway execution telemetry finalization，使用量查询可见真实 success 记录。

## Requirements

- WebChat 的一次逻辑 execution 必须在成功、失败和中断路径各自完成一次 telemetry finalization。
- 收到上游 `finish` 后，必须保留已产生的事件，同时让内层 execution generator 执行完 `finally`，再进入 Chat completion 持久化。
- provider error、自然 EOF 和 Abort 也不能留下永久 `running` 的 `gateway_executions` 记录。
- 保持现有 `runs`、SSE terminal 协议、重试/故障转移和用量查询的成功过滤语义不变。
- 不回填或删除历史 execution 数据；本任务只修复新请求的生命周期收敛。

## Acceptance Criteria

- [x] 普通 WebChat 成功生成后，`gateway_executions.status` 收敛为 `success`，并保留 token/延迟字段。
- [x] provider error、自然 EOF、Abort 后，execution 分别收敛为 `failed` 或 `interrupted`，不残留 `running`。
- [x] coordinator 不会因提前关闭外层 iterator 跳过内层 execution 的 `finally`/telemetry finalization。
- [x] 增加跨层回归测试，覆盖 finish/error/abort 的 iterator 收尾行为。
- [x] 定向测试、全量测试、lint、typecheck、build 通过。

## Notes

- 用量查询继续只展示 `success` execution；不能通过放宽查询条件掩盖未收敛状态。
