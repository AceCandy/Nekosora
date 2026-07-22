# 上传数据库失败时清理存储对象

## Goal

防止附件上传在对象存储写入成功、`file_objects` 插入失败时遗留无法由业务引用或清理的孤儿对象，同时不掩盖原始数据库异常。

## Background

- `route.ts:L72-L86` 当前先执行 `storage.put`，再插入 `file_objects`；插入异常直接冒泡，没有调用 `storage.delete`。
- `StorageDriver.delete` 已定义为幂等操作，key 不存在不视为错误，适合作为跨存储/数据库边界的补偿动作。
- 该窗口不能通过数据库事务覆盖，因为本地磁盘与对象存储不参与 PostgreSQL 事务。

## Requirements

- R1：仅在 `storage.put` 已成功且 DB 获取、schema 解析或 `file_objects` 插入失败时，对同一 `storagePath` 调用一次 `storage.delete`。
- R2：补偿删除成功后必须继续抛出原始数据库异常，不把上传伪装为成功。
- R3：补偿删除失败时必须记录清理错误，但仍抛出原始数据库异常，避免改变故障归因。
- R4：存储写入失败时不得执行数据库插入或补偿删除；数据库插入成功后不得误删对象。
- R5：保持现有文件名清洗、入队/同步处理与成功响应行为不变。

## Acceptance Criteria

- [x] AC1：回归测试证明 DB 获取或插入失败时，对实际生成的 storage key 调用一次 `delete`，并以对象身份断言原始 DB Error 继续冒泡。
- [x] AC2：回归测试证明补偿删除自身失败时，记录 cleanup Error，最终仍抛原始 DB Error。
- [x] AC3：回归测试证明 `storage.put` 失败时不调用 DB、queue 或 `storage.delete`。
- [x] AC4：现有成功上传测试证明 DB 成功后不调用 `storage.delete`，存储、落库与入队流程不回归。
- [x] AC5：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。

## Out Of Scope

- 队列 `send` 失败后的同步降级或任务重试策略。
- 图像生成路由的多对象批量补偿。
- 定时扫描并清理历史孤儿对象。
