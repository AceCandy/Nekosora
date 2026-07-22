# 原子抢占文件处理任务

## Goal

让 worker 与上传请求内 fallback 并发收到同一 `fileId` 时，最多只有一个执行者进入 extract/chunk/embed/persist 流水线，避免重复插入 `file_chunks`。

## Background

- `process.ts:L28` 当前无条件把记录更新为 `extracting`，任何并发调用都会继续处理。
- `process.ts:L72-L86` 采用“删旧块后分批插入”；并发执行可在双方 delete 后各自 insert，产生重复 chunk。
- `file_chunks` 只有 `file_id` 普通索引，没有 `(file_id, chunk_index)` 唯一约束。
- 队列投递失败 fallback 与服务端已接收的 pg-boss job 可能并发启动同一文件处理。

## Requirements

- R1：进入流水线前执行单条原子 update，仅允许 `processing_status IN ('pending', 'error')` 的目标行切换到 `extracting` + `extract_status='running'`，并通过 returning 判断是否抢占成功。
- R2：未抢占到行时立即返回，不调用提取、分块、嵌入、chunk delete/insert，也不覆盖现有状态。
- R3：抢占成功后保持现有 unsupported、empty、embedding unavailable/success 与 error 状态流转不变。
- R4：移除原有无条件首次 update，不能增加进程内锁或依赖单进程假设。
- R5：不新增数据库字段、索引或迁移。

## Acceptance Criteria

- [x] AC1：单测证明原子 claim 使用 fileId 与 `pending/error` 条件，并设置 extracting/running。
- [x] AC2：单测证明 claim 返回空数组时 `processFile` 直接结束，所有下游处理与 chunk 写入均未调用。
- [x] AC3：单测证明 claim 成功时 unsupported 文件继续写入 done/skipped 状态，基础流程不回归。
- [x] AC4：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。

## Out Of Scope

- 进程崩溃后长期停留在 `extracting/embedding` 的超时回收。
- 历史重复 chunks 去重或新增数据库唯一约束。
- 已完成文件的显式重新处理入口。
