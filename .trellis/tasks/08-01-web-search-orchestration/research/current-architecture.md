# 当前 Nekusora 搜索链路

## 已核验事实

- `src/app/api/chat/route.ts` 接收 `body.webSearch` 并传给 orchestrator；会话已有 `conversations.webSearch`，但请求回退语义不完整。
- `src/lib/chat/orchestrator.ts` 在联网开启后直接调用 `searchWeb(userId, userContent)`，因此模型不能决定是否搜索；结果被拼入 system prompt。
- `src/lib/web-search/registry.ts` 只取首个 enabled Provider，构造失败或执行失败都不会尝试后续条目。
- `src/lib/web-search/service.ts` 用 `Promise.race` 做 8 秒外层超时，不能取消底层 fetch；query cache 未包含完整配置版本。
- `src/lib/web-search/searxng.ts` 直接使用用户 baseUrl fetch，没有 scheme、DNS、私网和重定向防护。
- 搜索 API key 以 `user_settings` JSON 明文保存，完整配置被传入客户端组件；编辑状态可获得完整 key。
- `messages.processTrace` 已是 JSONB，assistant completion 已有统一 coordinator/repository 提交路径，可扩展搜索 trace 而无需新表。
- 搜索结果当前仅在 Zustand；`switchVersion` 会清空 `searchResults`，刷新和版本切换都不能恢复。
- `streamChatWithTools` 已有 MCP Agent loop、tool audit 和统一 runId；Hosted Search 必须与其合并，并区分 AI SDK `providerExecuted`。
- `ModelCapabilities` 已有 `tools?: boolean`，但没有 hosted search 字段；`model_catalog.capabilities` 是现有能力事实来源。

## 主要风险

1. SearXNG SSRF 与密钥下发属于上线前必须先处理的安全问题。
2. 假超时会留下后台请求，工具 Agent 化后可能放大连接与费用泄漏。
3. Hosted Search、MCP 和本地搜索若分别注入工具，主模型会看到重复能力并可能重复搜索。
4. 搜索事件若只改 SSE 而不进入 assistant completion，会继续在刷新和版本切换后丢失。
5. 模型目录能力与具体 route translator 必须同时成立；只有模型名匹配不能证明当前路由可搜索。

## 建议测试落点

- `src/lib/web-search/registry.test.ts`
- `src/lib/web-search/service.test.ts`
- `src/lib/web-search/searxng.test.ts`
- `src/lib/chat/orchestrator.test.ts`
- `src/lib/stream.test.ts`
- `src/lib/stream-agent-loop.test.ts`
- `src/lib/chat/completion-coordinator.test.ts`
- `src/lib/chat/completion-repository.test.ts`
- `src/app/api/chat/route.test.ts`
- `src/features/chat/actions/branch.test.ts`
- `src/features/chat/store/chatStreamStore.test.ts`
- `src/lib/model-catalog.test.ts` 与 sync-pi-models 对应测试

来源：CodeGraph 当前工作树结果、现有 `.trellis/spec/backend/web-search.md`、三轮独立只读核验。
