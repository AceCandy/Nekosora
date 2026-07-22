# 实施计划

1. 保留红灯证据：初始生产审计 4 moderate；node-server 2.0.5 复验仍有 1 moderate，因此最终目标为 2.0.10。
2. 在 `pnpm.overrides` 增加两个 SDK 1.29.0 作用域的精确 override。
3. 更新 lockfile，审查 diff 不包含无关 peer 或顶层依赖漂移。
4. 运行冻结离线安装，并用 `pnpm why` 与 lockfile 搜索确认实际版本。
5. 导入四个 MCP 客户端入口；构造、启动并关闭 Node Streamable HTTP 服务端 transport。
6. 运行 moderate 级生产审计、lint、typecheck、全量测试、生产构建与 `git diff --check`。
7. 独立复核 override 边界、临时产物、服务进程与剩余审计风险。
