# 消除剩余生产依赖中危漏洞

## Goal

消除生产依赖树中剩余的 4 个 moderate 安全告警，同时保持 `@modelcontextprotocol/sdk` 1.29.0 与现有顶层依赖版本不变，并验证 SDK 客户端和 Node Streamable HTTP 服务端适配均可加载。

## Background

- `pnpm audit --prod --json` 显示 4 个 moderate：3 个来自 `@modelcontextprotocol/sdk -> hono 4.12.26`，修复要求 `hono >=4.12.27`。
- 另 1 个来自 `@modelcontextprotocol/sdk -> @hono/node-server 1.19.14`；2.0.5 修复原 advisory 后仍命中 `GHSA-9mqv-5hh9-4cgg`，完整修复要求 2.0.10，属于跨主版本覆盖。
- Nekusora 当前只导入 MCP 客户端模块；SDK 的 `server/streamableHttp.js` 依赖 `@hono/node-server#getRequestListener`。
- `@hono/node-server` 2.0.10 仍导出 `getRequestListener`，peer 仍为 `hono ^4`，Node 要求 `>=20`；项目要求 Node `>=22`。

## Requirements

- R1：通过现有 `pnpm.overrides` 将 SDK 1.29.0 的 `hono` 精确覆盖到 4.12.31。
- R2：仅将 SDK 1.29.0 的 `@hono/node-server` 覆盖到 2.0.10，不改变其他消费者的版本选择。
- R3：同步 lockfile，旧 `hono 4.12.26` 与 `@hono/node-server 1.19.14` 不再解析。
- R4：不得升级 MCP SDK 或其他顶层依赖，不修改应用业务代码。
- R5：验证项目实际使用的 MCP 客户端入口可导入，并验证 SDK 的 `StreamableHTTPServerTransport` 可构造、启动和关闭。

## Acceptance Criteria

- [x] AC1：`pnpm audit --prod --audit-level moderate` 退出码 0，生产依赖 info/low/moderate/high/critical 均为 0。
- [x] AC2：`pnpm why` 与 lockfile 证明 SDK 使用 `hono 4.12.31` 和 `@hono/node-server 2.0.10`，旧版本不存在。
- [x] AC3：MCP Client、Stdio/SSE/Streamable HTTP 客户端入口均可导入。
- [x] AC4：SDK Node `StreamableHTTPServerTransport` 可构造、`start()` 并 `close()`，证明 `getRequestListener` 兼容。
- [x] AC5：冻结离线安装、lint、typecheck、350 项全量测试、生产构建与 `git diff --check` 通过。
- [x] AC6：`package.json` 除两个 SDK 作用域 override 外无变化，无临时包、缓存或服务进程残留。

## Out of Scope

- 升级 `@modelcontextprotocol/sdk` 或改造 MCP registry。
- 为项目新增 MCP 服务端能力。
- 修复开发依赖审计或引入自动 audit fix。
