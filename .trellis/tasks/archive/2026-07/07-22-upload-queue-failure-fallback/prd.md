# 队列投递失败时回退文件处理

## Goal

确保附件对象与数据库记录已持久化后，即使 pg-boss 队列获取或投递失败，也会启动现有同步文件处理 fallback，而不是让上传失败并将记录永久留在 `pending`。

## Background

- `route.ts:L98-L106` 仅在 `queue.available === false` 时调用 `processFile`；`getQueue()` 与 `queue.send()` 都位于 try/catch 之外。
- `queue.ts` 的唯一 `QueueAdapter` 实现固定 `available: true`，初始化或 pg-boss send 失败会直接抛错，因此当前 fallback 分支无法覆盖真实队列故障。
- 项目没有扫描 `file_objects.processing_status = pending` 并补投任务的恢复流程。
- `processFile` 是现有无队列处理入口，并明确声明重复处理幂等。

## Requirements

- R1：捕获 `getQueue()` 与 `queue.send()` 的异常，记录队列投递错误后启动一次 `processFile` fire-and-forget fallback。
- R2：`queue.available === false` 时继续直接启动 fallback，不记录伪造的队列错误。
- R3：入队成功时不得调用 `processFile`；fallback 必须使用相同 `fileId`、`storagePath` 和规范化 MIME。
- R4：fallback Promise 拒绝时沿用现有日志处理，不能产生未处理 rejection，也不能把已持久化上传改回失败响应。
- R5：保持 DB 前补偿、成功响应与文件名安全逻辑不变。

## Acceptance Criteria

- [x] AC1：回归测试证明 `getQueue` 抛错时响应仍为 200，记录 queue Error，并以实际 fileId/key/mime 调用一次 `processFile`。
- [x] AC2：回归测试证明 `queue.send` 抛错时执行同一 fallback，DB 与 storage 对象不被删除。
- [x] AC3：回归测试证明 `available:false` 直接 fallback，成功 send 则不 fallback。
- [x] AC4：回归测试证明 fallback 自身拒绝时记录同步处理错误，且没有未处理 rejection。
- [x] AC5：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。

## Out Of Scope

- pg-boss send 在服务端成功、客户端却收到断连错误时的 exactly-once 保证。
- `processFile` 并发互斥或 file chunk 唯一约束。
- 历史 pending 记录补扫与重试管理界面。
