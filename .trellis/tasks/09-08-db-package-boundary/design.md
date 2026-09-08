# 设计

现状：`packages/db/package.json` 已提供 `/types` 和 `/schema` 导出，消费端却在 10 份配置里直指其源码。61 个源码/测试文件引用旧数据库别名；多数为 type-only 导入，少数为纯协议函数、PG 测试和工厂 mock。

选择：直接复用现有包导出。逐行替换两种模块路径，删除 tsconfig paths、Vitest alias、tsup alias 的数据库项及因此无用的 `dbSrc` 变量。保留其他别名及 Web 的依赖 dedupe。无需新兼容入口。

工厂仍动态 import 包内 `./schema`，测试改从包公开 Schema 路径 mock 同一个模块。类型引用不升级为运行时引用；客户端不会因此加载 Schema/pg。`types.ts` 的运行时协议函数仍指向原文件。

本批先完成数据库这一条包边界，父任务的全部跨包边界验收保持未完成。回滚可反向应用此批独立 diff，不涉及数据回滚。

复核确认 `apps/web/drizzle.pg.config.ts` 仍通过文件路径使用 `src/db/schema/pg.ts`；这是迁移工具输入，并非无引用业务入口，本批保留。`src/db/types.ts` 的历史转发也保留，其他兼容入口不在本批删除范围。
