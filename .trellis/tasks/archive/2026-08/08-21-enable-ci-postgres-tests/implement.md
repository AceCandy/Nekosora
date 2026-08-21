# CI PostgreSQL 集成测试实施计划

1. [x] 补编排脚本的安全校验测试。
2. [x] 实现最新 schema PG 套件的隔离数据库编排，复用现有脚本代码模式。
3. [x] 为 Web/Core workspace 增加明确的 `test:pg` 脚本入口。
4. [x] 在 quality workflow 增加 pgvector service 和 PostgreSQL 测试步骤。
5. [x] 本机 pgvector 环境验证所有目标套件真实执行且清理完成。
6. [x] 运行 `pnpm lint:workflows`、相关脚本测试、Core/Web lint 与 typecheck。

## Rollback Point

- workflow 和编排脚本作为独立提交；CI 时间或稳定性异常时整体回滚，不改普通单测路径。
