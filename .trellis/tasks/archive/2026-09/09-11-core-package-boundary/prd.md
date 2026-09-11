# Core 包边界收敛

## Goal

共享包自行解析内部依赖；应用只通过显式包导出使用共享服务。

## Requirements

- Core 内部旧 `@/lib/*`、`@/auth` 改为相对引用，保持实际文件解析与类型/动态导入形式。
- Web 共享导入及 mock 使用 Core 已有或实际消费所需的显式导出；5 个 Web 专属适配仍留在本地。
- 删除 TypeScript、Vitest、tsup 的重复 Core 源码映射，保持构建外部依赖策略。
- 本批不改业务逻辑、SQL、数据、客户端边界或迁移工具入口；后续继续聊天 SSE 收敛。

## Acceptance Criteria

- [x] 旧 Core 跨包别名清零；迁移前后每个引用解析到相同文件。
- [x] 类型检查、现有测试、Web/Gateway/Worker 构建通过。
- [x] 独立复核通过，规范与剩余兼容入口用途同步记录。
