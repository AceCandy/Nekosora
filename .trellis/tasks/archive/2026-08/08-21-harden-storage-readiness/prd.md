# 收紧存储与健康检查行为

## Goal

取消远端存储静默本地降级并处理 readiness 悬挂操作风险

## Requirements

- 未配置 `STORAGE_DRIVER` 或明确配置 `local` 时继续使用本地存储。
- 显式配置 `s3`、`r2` 或 `minio` 时，缺少必要配置或初始化失败必须报错，不得回退本地。
- 非空且不支持的 `STORAGE_DRIVER` 必须在环境校验阶段报错，不得被当作 local。
- 环境校验错误不得包含密钥值。
- Gateway readiness 超时后，同一依赖的未完成检查不得随探针次数无限累积。
- 保持 readiness 当前响应结构和 2 秒对外超时行为。
- 不为存储降级增加新开关。

## Acceptance Criteria

- [x] 空值和 `local` 返回 LocalDriver。
- [x] 远端 driver 配置缺失或构造失败时返回明确错误，且不会创建 LocalDriver。
- [x] 非法 `STORAGE_DRIVER` 被 `validateEnv` 拒绝。
- [x] 同一依赖首次检查悬挂时，重复 readiness 调用不会启动新的底层检查。
- [x] 底层检查恢复后，后续 readiness 可以重新执行。
- [x] 环境、存储和 Gateway server 相关测试通过。

## Notes

- S3Driver 构造当前不发网络请求；本任务处理配置/构造失败和探针并发边界，不增加启动时对象存储读写探测。
