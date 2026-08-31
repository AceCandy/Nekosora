# 三项加固集成设计

## Boundaries

父任务不修改业务代码，只协调三个可独立回滚的子任务：

1. Provider：在共享 `fetchUpstreamModels` 信任边界限制重定向、响应字节和模型数量。
2. Offline：在浏览器聊天入口、上传入口和 Sidebar 复用同一个明确离线判定。
3. RAG：沿现有 process trace JSON 契约传递文件级来源，并在私有 Chat 中复用鉴权预览。

三项均不新增依赖。Provider 与 Offline 不改数据库；RAG 只扩展既有 JSONB 内容，不新增迁移。

## Integration Order

```text
Provider hardening
  -> Offline preflight
  -> RAG structured sources
  -> Cross-child privacy and regression review
```

先处理无 UI 契约依赖的 Provider，再处理局部前端边界，最后处理跨 Core/contracts/Web 的 RAG 数据流，减少并行修改共享测试和消息组件的风险。

## Shared Invariants

- 错误信息不包含 API key、认证头、私有文件正文或内部检索分数。
- 失败不覆盖 Provider 旧缓存，不制造离线数据库写入，不改变匿名分享隐私边界。
- 共享函数、共享类型和既有预览组件继续作为唯一事实来源，不复制协议或能力判断。
- 每个子任务先跑定向测试；全部完成后再做父任务级类型、测试和 diff 复核。

## Compatibility And Rollback

- 三个子任务均为 additive guard 或 JSON 可选字段，旧数据与旧历史继续可读。
- 子任务按目录独立启动、检查和归档；任一子任务失败可单独回滚，不阻塞其余已验证改动。
- RAG 回滚只需停止生成/渲染 `sources` 字段；已有 JSONB 中的未知字段可被旧代码忽略。
