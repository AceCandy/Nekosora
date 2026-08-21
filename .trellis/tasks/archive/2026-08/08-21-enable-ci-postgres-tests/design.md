# CI PostgreSQL 集成测试设计

## CI Service

- 在 quality job 增加 `pgvector/pgvector:pg16` service、固定测试凭据和 `pg_isready` 健康检查。
- 只把本机 service 管理库 URL 暴露给测试编排脚本，不把凭据打印到日志。

## Test Orchestration

- 保留 API key 历史迁移专用脚本。
- 为最新 schema 的 Core PG 套件增加一个小型编排入口：创建随机隔离库、启用 vector、执行 Drizzle 迁移、设置各套件期望库名、运行目标文件、finally 强制清理。
- 统一测试库名前缀，测试守卫同时校验 `TEST_DATABASE_URL`、期望库名和安全正则。
- 不让常规 `pnpm test` 隐式依赖 PostgreSQL；CI 追加明确 `test:pg` 步骤。

## Failure And Cleanup

- service、迁移、测试或清理任一阶段失败均返回非零。
- 错误输出只保留阶段和脱敏错误分类。
- 删除数据库前终止目标数据库连接，并再次验证安全前缀。
