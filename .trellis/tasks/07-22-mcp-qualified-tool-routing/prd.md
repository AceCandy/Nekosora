# 修复 MCP 工具限定名歧义

## Goal

确保包含连续标点或下划线的 MCP server 名称生成无歧义工具限定名，使模型返回的工具名能稳定路由回正确 server 与原始 tool。

## Background

- 当前格式为 `<sanitizedServerName>__<toolName>`，但 server 清洗只把每个非法字符替换为 `_`，不会消除连续 `_`。
- `parseQualifiedToolName` 在第一个 `__` 处分割。`my--server` 因此生成 `my__server__read_file`，随后被错误解析成 server=`my`、tool=`server__read_file`。
- 已用现有函数复现该输出，最终 `callMcpTool` 会返回 server 不可用，真实工具不会执行。

## Requirements

- R1：server 名称规范化后不得包含分隔符 `__`；连续非法字符或下划线统一折叠为单 `_`。
- R2：`qualifyToolName` 与 `callMcpTool` 的 server 名匹配必须使用同一规范化函数。
- R3：普通名称与原始 tool 名称保持不变；tool 名中包含 `__` 时仍完整保留在分隔符之后。
- R4：不得改变 `parseQualifiedToolName` 的导出签名、MCP handle 契约或工具调用参数。

## Acceptance Criteria

- [x] AC1：单测证明 `my--server`、`my__server` 都生成 `my_server__read_file`，并解析为 server=`my_server`、tool=`read_file`。
- [x] AC2：单测证明存在 `my` 与 `my--server` 时，限定名精确路由到后者，不误调前者。
- [x] AC3：单测证明原始 tool 名中的 `__` 保留，调用参数透传，调用结束后 handle 正常关闭。
- [x] AC4：未匹配 server 的现有错误行为保持不变。
- [x] AC5：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。
- [x] AC6：没有新增依赖、临时文件或服务进程残留。

## Out of Scope

- 为规范化后完全同名的两个 server 设计新的全局唯一编码。
- 修改数据库中的 server 名称或唯一性约束。
- 改变模型工具名称的整体格式。
