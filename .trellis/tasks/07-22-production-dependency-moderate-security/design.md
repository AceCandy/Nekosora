# 生产依赖中危漏洞修复设计

## Resolution Strategy

```text
@modelcontextprotocol/sdk@1.29.0 -> hono 4.12.26
                                  scoped override -> 4.12.31

@modelcontextprotocol/sdk@1.29.0 -> @hono/node-server 1.19.14
                                  scoped override -> 2.0.10
```

两个 override 都限定到 MCP SDK 1.29.0，避免改变其他潜在消费者。Hono 是同一 4.12 patch line；node-server 跨主版本，但 SDK 唯一使用的 `getRequestListener(fetchCallback, options)` 在 2.0.10 中仍保留，peer 仍接受 Hono 4。2.0.10 同时避开 2.0.0-2.0.9 的 WebSocket 握手内存泄漏 advisory。

## Compatibility Gate

依赖解析完成后，分别导入项目实际使用的四个客户端入口，并构造 SDK Node `StreamableHTTPServerTransport`。构造函数会立即调用 `getRequestListener`，因此 `start()`/`close()` smoke test 可覆盖跨主版本的关键运行时边界。

## Rollback

回滚两个 override 和 lockfile 解析即可。若 SDK 服务端 transport smoke test 或生产构建失败，不接受只修复 Hono 3 条告警而保留不完整方案；回到审视阶段重新评估 SDK 升级或 advisory 暴露面。
