# 技术方案

复用 Database/Schema 和表推导类型，以精确 select 结果构建最小 DTO。保留可注入 RouteRepository，测试替身是其真实用途；不因只有一个生产实现删除它。同步直接调用方与必要 fixture，不扩展其他仓储。

每批单独检查、提交与回滚；无需数据迁移。不删除现有测试。
