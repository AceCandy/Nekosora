# 执行计划

- [x] 确认干净工作区、已发布包导出与全部数据库别名引用。
- [x] 替换消费端两种导入路径，保留其他字节及测试断言。
- [x] 删除 10 份配置中的数据库别名和对应无用变量。
- [x] 同步前端目录规范和后端质量规范中的旧数据库别名约定。
- [x] 运行 `pnpm check`、`pnpm test`、三个应用构建及 `git diff --check`。
- [x] 独立审查模块解析、type-only、mock 和改动范围；记录剩余债务和验证结果。

基线：上一批质量检查通过，测试 1845 passed / 42 skipped；本批从 `c89667b` 干净工作树开始。用户要求继续既有路线图，本批据此规划并实施。

改动范围：61 个含旧模块路径的 TS/TSX 源码/测试文件，四份 tsconfig、四份 Vitest、两份 tsup 配置；直接失效规范与本任务记录。

## 验证结果

- `pnpm check`：工作区覆盖、零警告 lint、全部包 typecheck 通过。
- `pnpm test`：1845 passed / 42 skipped，与基线相同；工厂 8 项回归通过，公开 Schema mock 命中真实模块。
- `pnpm --filter @nekusora/gateway --filter @nekusora/worker build`：通过。
- `pnpm build`：Next.js Turbopack 生产编译、类型检查、静态生成通过。
- 对全部 61 个源码/测试文件以 HEAD 原文只替换两种路径后逐字节对比，全部相等；10 份配置只删除数据库解析项。
- 独立只读审查确认包导出和 type-only 引用正确；主线程补查发现 Schema 转发仍被 Drizzle 配置引用，因此保留。无业务逻辑、测试断言或数据改动。
- `git diff --check`、任务上下文校验通过；源码/配置无旧数据库别名残留。
- 构建产物 `.next`、两个 `dist` 已由现有 `.gitignore` 排除，留作本地构建输出；没有启动调试服务。
- 未运行真实 PostgreSQL、浏览器流程或迁移生成。Core 源码别名和兼容转发仍是后续治理项。

## 交付状态

实现与验证完成，尚未提交或推送。建议独立提交 `refactor: use database package exports`，范围为上述产品文件、两份规范、本子任务和父路线图记录。
