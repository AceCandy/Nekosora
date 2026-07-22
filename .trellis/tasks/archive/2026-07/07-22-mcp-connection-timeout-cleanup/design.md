# MCP 连接超时资源清理设计

## Lifecycle

```text
withConnectionTimeout(connect, timeoutMs)
  -> 创建 AbortController + 硬超时 Promise
  -> connect(signal)
       -> connectMcpClient(client, transport, signal)
            -> 注册 abort => transport.close()
            -> client.connect(transport, { signal })
  -> 成功/普通失败:clearTimeout
  -> 超时:abort + reject(mcp_connect_timeout) + clearTimeout
```

硬超时 Promise 保证即使第三方 transport 不响应取消，调用方也能按时降级；AbortSignal 与主动 `transport.close()` 负责清理仍在后台运行的连接。两者缺一不可。

## Boundaries

- 新增 `src/lib/mcp/connection.ts`，只承载可独立测试的连接生命周期，不依赖数据库或具体 transport 类。
- `registry.ts` 保留 transport 构造与 stdio pool 所有权，只把 signal 传入三个 connector。
- `connectMcpClient` 使用结构类型兼容 SDK Client/Transport，不导出第三方具体类型。

## Compatibility

成功路径不触发 close：stdio 仍在连接成功后写入 pool，SSE/HTTP 仍由现有 `McpClientHandle.close()` 在工具调用后关闭。普通错误保持原对象；只有硬超时统一映射为 `mcp_connect_timeout`。

## Rollback

回滚 `connection.ts`、测试与 `registry.ts` signal 接线即可恢复原行为，无配置、数据库或 API 迁移。
