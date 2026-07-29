# RAG 文件处理状态机

## Goal

将文件处理的 claim、lease heartbeat、阶段转换、fencing、chunk 原子替换、失败分类与 stale recovery 收拢到一个 RAG processing state machine，使直接 worker、恢复扫描和未来调用方共享同一所有权契约。

## Background

- `src/lib/rag/process.ts` 同时承担业务流水线和 lease 状态控制。
- `src/lib/rag/recovery.ts` 另行定义 stale 扫描、调度和 per-file 隔离。
- 现有 PostgreSQL tests 已证明并发 claim、lease loss 和恢复语义，重构必须保留并深化这些契约。

## Requirements

- R1. Lease repository 独占数据库 claim、renew、owned transition 和 terminal write 条件；所有判断使用 PostgreSQL clock 与 fencing token。
- R2. Processing coordinator 明确 `pending -> extracting -> embedding -> rag_ready|error` 状态转换及允许的恢复入口。
- R3. Lease loss 立即停止后续领域写入；旧 owner 不能删除/替换 chunks、覆盖 error 或写 terminal status。
- R4. Chunk 替换与 `rag_ready` 必须在持有有效 lease 的短事务内原子提交。
- R5. Extraction、embedding、storage 和持久化失败必须有稳定分类，明确可重试/终止语义；错误落库和 console 均脱敏、有界。
- R6. Direct worker 和 stale recovery 调用同一 coordinator，不复制 claim 或阶段条件。
- R7. Recovery 保持稳定排序、扫描上限、per-file 隔离和 single-flight scheduler；进程停止等待当前 scan。
- R8. 上传 API、用户文件可见性和 RAG 检索结果契约保持不变。

## Acceptance Criteria

- [ ] 删除新 lease/state module 会使 direct/recovery 的共同契约测试失败，证明模块具有杠杆。
- [ ] 两个并发 owner 只有一个进入 extract/embed；旧 owner 在 lease 被夺取后无法提交任何 chunk 或终态。
- [ ] heartbeat pending 时保持 single-flight，停止后不再调度新 heartbeat。
- [ ] chunk replacement、rag_ready 和 lease clear 为同一 owner 条件事务。
- [ ] pending、stale extracting、stale embedding 都能恢复；fresh lease 不被抢占。
- [ ] retryable 与 terminal error 矩阵有 unit tests 和真实 PostgreSQL tests。
- [ ] 现有文件上传、状态展示和检索 tests 保持通过。

## Dependencies

- 本任务无强制代码依赖，但路线图顺序要求 Chat 完成事务先完成。
- 本任务输出稳定 recovery/handler adapter，供 `07-30-worker-queue-lifecycle` 使用。

## Out Of Scope

- pg-boss 通用 start/stop 与 worker signal 编排。
- 替换 extraction/chunking/embedding 算法或向量数据库。
- 新增文档解析格式或前端文件管理功能。

## Planning Gate

实现前必须研究当前 schema、真实 PostgreSQL 并发测试和 embedding 失败语义，完成 lease adapter 接口、状态转换表、迁移/回滚设计与执行计划。
