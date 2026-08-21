# 存储与 readiness 实施计划

1. [x] 先补失败测试：非法 driver、远端缺配置不降级、readiness 悬挂检查单飞。
2. [x] 收紧 `getEnvInfo`/`validateEnv` 与存储工厂，删除远端 catch-to-local。
3. [x] 在 Gateway readiness 内复用项目已有 in-flight promise 模式。
4. [x] 同步 `.env.example`、README 和存储 smoke 测试中的降级说明。
5. [x] 验证 Core/Gateway 目标测试、lint、typecheck。

## Rollback Point

- 环境/存储行为和 readiness 单飞保持同一子任务提交；回滚会恢复旧降级语义，需明确记录数据风险。
