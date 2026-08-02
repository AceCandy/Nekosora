# 技术设计：路由工具能力默认开启与自动复标

## 目标与边界

把路由工具能力从“新增字段默认关闭”调整为“新增路由默认开启”，同时保留已有 `false` 数据。运行时只对能够从上游错误中明确识别为工具参数不兼容的具体路由执行自动降级和持久化复标。

不处理 HTTP 成功但返回普通工具 JSON 的静默协议不兼容，也不根据搜索/MCP/参数等工具执行结果自动改变路由能力。

## 数据与管理端

- `routes.supports_tools` 的 Drizzle schema 默认改为 `true`。
- 新增 PostgreSQL 迁移只执行 `ALTER COLUMN ... SET DEFAULT true`，不执行历史行回填；已有 `false` 路由保持关闭。
- 同步 Drizzle journal/snapshot 与迁移契约测试。
- 新建路由表单默认勾选“支持工具调用”；编辑表单继续回显数据库值，管理员取消勾选仍保存 `false`。
- 快速附加/模型创建时省略该字段的插入路径依赖数据库新默认；显式表单路径继续由 checkbox 决定。

## 运行时数据流

```text
带 tools 的请求
      │
      ▼
resolveRoutes → 每条 ResolvedRoute 携 routeId + supportsTools
      │
      ├─ supportsTools=false / model capabilities 不支持
      │      └─ rejected，继续下一条路由
      │
      ├─ 上游明确拒绝 tools/tool_choice
      │      ├─ routeId 条件更新 supportsTools=false
      │      └─ 未提交响应时继续下一条支持工具路由
      │
      └─ 所有工具路由都不能使用且尚未输出
             └─ 同一请求无 tools 重试一次
```

WebChat 与 `/v1/chat/completions` 都经过 `streamChat`，因此复用同一逻辑。工具本身的执行发生在 `streamChatWithTools` 的工具调用事件之后；该阶段的错误只形成 `tool-result.isError`，不触发路由复标。

## 错误识别

在网关策略层增加一个纯判定函数，读取 AI SDK 错误包装的 `statusCode`、`responseBody`、`data` 和消息文本，但不把原始 body 写入安全错误或日志。只有状态码为 400/422 且文本同时包含工具字段线索（如 `tools`、`tool_choice`、`function_call`）和明确不支持语义（如 `unsupported`、`not supported`、`not allowed`）时返回真。

状态码、单独的 `tool` 字样、普通 `invalid_request`、超时、限流、鉴权和服务端错误都不能触发复标。检测结果只影响当前 chat stream 的路由控制，不改变通用错误分类契约。

## 执行引擎契约

给 `ExecuteGatewayOptions` 增加 chat 专用可选回调：

- `isToolUnsupported(error)`：识别上游明确拒绝。
- `onToolUnsupported(route)`：在当前 route 上执行条件更新。

引擎捕获到该错误时：

1. 记录当前 route 的失败遥测，但不污染 provider breaker。
2. 调用复标回调，回调失败只被吞掉，不影响请求。
3. 将本次内部错误标记为 `tools_not_supported`，不在已有响应提交后切路由。
4. 未提交响应时结束当前 route 的 key 尝试，继续下一 route。

`streamChat` 在执行结果为工具不支持/工具路由全部被预拒绝、且 `committed=false` 时，把请求复制为 `tools: undefined` 再执行一次。成功或失败后均不再重试；对外只暴露最终结果。已有普通错误路径不变。

## 路由复标持久化

在路由数据访问边界增加按 `routeId` 的条件更新：`id = routeId AND supports_tools = true`，只写 `supports_tools=false`。`routeId` 来自已完成可见性、owner 和 key 绑定校验的 `ResolvedRoute`，不接受客户端直接提交的路由 ID。

## 兼容性与回滚

- 迁移只改变未来默认值，回滚只需把列默认恢复为 `false`；已有行不受迁移影响。
- 代码回滚后，自动复标字段写入仍是合法的布尔值，不会破坏旧版本读取。
- 若上游错误形态无法稳定识别，判定函数返回 `false`，请求沿用原错误/故障转移行为，不产生错误复标。
- 不启动真实 Provider 请求验证，不在本地迁移生产数据。
