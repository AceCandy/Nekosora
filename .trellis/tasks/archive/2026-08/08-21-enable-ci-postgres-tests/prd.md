# 启用 CI PostgreSQL 集成测试

## Goal

让关键 PostgreSQL 集成测试在 CI 中实际执行并失败可见

## Requirements

- CI 使用与本地部署一致的 `pgvector/pgvector:pg16` 服务。
- 关键 PostgreSQL 集成套件必须在 CI 中实际执行，不得因缺少环境变量静默 `describe.skip`。
- 每次套件使用随机命名隔离数据库，并保留现有前缀校验和本机连接限制。
- 复用现有迁移与隔离数据库脚本模式，不引入新的测试框架或容器依赖。
- 普通单测与 PostgreSQL 集成测试保持分步，失败位置可见。
- 测试日志不得输出数据库密码或完整连接串。

## Acceptance Criteria

- [x] CI PostgreSQL 服务通过健康检查后才运行集成测试。
- [x] gateway governance、gateway retention、chat completion、file processing lease 和 API key migration 套件均实际执行。
- [x] 缺少或无法连接测试数据库时 CI 明确失败。
- [x] 隔离数据库无论成功失败都被清理，且安全校验拒绝非测试库名。
- [x] workflow lint、相关脚本测试和目标 PG 套件通过。

## Notes

- API key migration 套件需要从历史迁移前缀升级，继续使用其专用脚本，不并入普通最新 schema 套件。
