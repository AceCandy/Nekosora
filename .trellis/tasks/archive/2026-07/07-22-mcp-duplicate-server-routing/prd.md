# 修复 MCP 同名 server 工具误路由

## Goal

确保当前请求同时解析到规范化后同名的全局与 BYO MCP server 时，每个 server 的工具获得唯一限定名，并能路由回生成该工具定义的准确 client。

## Background

- `mcp_servers` 的 `name` 没有唯一约束；用户可同时看到全局 server 与自己的 BYO server。
- `toIRTools` 当前只用规范化名称生成工具名，两个 `filesystem` 都得到 `filesystem__read`。
- `callMcpTool` 用 `find` 取第一个同名 server，因此第二个 server 永远不可达；已通过现有函数复现结果总是返回 `global` client。

## Requirements

- R1：为同一 `ResolvedMcpServer[]` 生成确定性、互不重复的 server 前缀。
- R2：第一个前缀保留规范化基础名；冲突项使用 `_2`、`_3` 递增，并避开已占用的天然后缀名。
- R3：`toIRTools` 与 `callMcpTool` 必须使用同一前缀分配逻辑，以 server `id` 关联映射。
- R4：没有冲突的 server 工具名保持不变；原始名称直接匹配继续作为兼容 fallback。
- R5：不得修改数据库约束、MCP SDK 接口或前端配置。

## Acceptance Criteria

- [x] AC1：两个同名 server 生成 `filesystem__read` 与 `filesystem_2__read`，分别调用各自 client。
- [x] AC2：规范化后碰撞的不同名称同样分配唯一前缀。
- [x] AC3：`x`、重复 `x` 与天然 `x_2` 同时存在时，三个前缀仍唯一且路由正确。
- [x] AC4：单一非冲突 server 的限定名与现有行为一致，未知 server 错误不变。
- [x] AC5：调用参数、tool 名、isError 与 handle close 语义保持不变。
- [x] AC6：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过，无新增依赖或服务残留。

## Out of Scope

- 跨请求持久化 server 前缀；工具列表与工具调用在同一请求内共享 server 数组即可。
- 解决同一 MCP server 内部重复 tool 名称。
- 新增数据库 name 唯一约束或改变全局/BYO 可见性。
