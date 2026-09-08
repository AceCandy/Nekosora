# 数据库包导入边界收敛

## Goal

让数据库包消费者通过现有公开导出解析模块，消除各应用重复维护的数据库源码别名。

## Requirements

- R1：消费端 `@/db/types`、`@/db/schema/pg` 分别使用 `@nekusora/db/types`、`@nekusora/db/schema`。
- R2：同步清除 Web、Gateway、Worker、Core 的 TypeScript、Vitest、tsup 数据库别名；不新增导出、依赖或别名替代层。
- R3：保留 type-only 引用、Schema 动态加载、mock 隔离、查询和业务行为。
- R4：同步直接失效的导入规范，记录其余 Core 源码别名仍待收敛。

## Acceptance Criteria

- [x] 应用和共享包源码/配置无旧数据库别名；所有导入指向现有 package exports。
- [x] `pnpm check`、`pnpm test` 通过，测试断言与跳过数量不变。
- [x] Gateway、Worker、Web 构建通过；独立复核确认只有路径与对应解析配置发生变化。
- [x] 报告未执行的真实数据库和浏览器验证；无不应入仓的本地构建产物。

## Out of Scope

Core 的 `@/lib/*`、`@/auth`、HTTP 回滚入口和其他兼容转发保留；后续独立治理。不改 UI、SQL、Schema、依赖版本或连接生命周期。
