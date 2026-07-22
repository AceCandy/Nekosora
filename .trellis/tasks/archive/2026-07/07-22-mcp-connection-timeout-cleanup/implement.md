# 实施计划

1. 新增连接生命周期单测，先覆盖超时关闭、成功清定时器、普通错误传播三条行为。
2. 实现 `withConnectionTimeout` 与 `connectMcpClient`，使红灯测试通过。
3. 将 `registry.ts` 的三个 connector 接到同一 AbortSignal，不改变 pool 与 handle 包装语义。
4. 运行目标测试、lint 与 typecheck；检查 CodeGraph 影响范围和 diff。
5. 运行 350+ 项全量测试、生产构建与 `git diff --check`，独立复核资源清理和错误契约。
