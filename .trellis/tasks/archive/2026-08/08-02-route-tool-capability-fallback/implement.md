# 实施计划：路由工具能力默认开启与自动复标

## 顺序清单

1. 更新 `routes.supports_tools` schema 默认值，生成只改数据库默认值的下一条 PostgreSQL 迁移，并同步 journal/snapshot；保留历史 `false` 行。
2. 将新建路由表单默认勾选工具能力，核对个人/管理员显式创建、快速附加和模型创建的默认行为。
3. 在路由数据访问边界增加按 `routeId` 且当前值为 `true` 的降级更新函数。
4. 在网关策略层实现保守的 tools/tool_choice 不兼容判定，覆盖 AI SDK 包装错误的状态码、response body/data 和消息文本，避免记录原始 body。
5. 扩展网关执行选项与引擎：识别工具不兼容、记录当前 route、跳过同 route 剩余 key、继续其他 route，并禁止该类错误触发 breaker。
6. 在 `streamChat` 增加一次性无工具重试；保持已提交响应不重试、WebChat 与 `/v1` 共用行为、agent loop 工具执行错误不复标。
7. 补充迁移/表单/路由复标/错误判定/引擎与流式降级回归测试。
8. 独立复核 diff，运行定向测试、`pnpm check` 与完整测试门禁；确认工作树中与本任务无关的既有修改未被触碰。

## 验证命令

- `pnpm vitest run src/lib/model-catalog.test.ts src/lib/stream.test.ts src/lib/gateway-execution/engine.test.ts src/lib/stream-agent-loop.test.ts src/app/(dash)/panel/actions.test.ts src/app/(dash)/admin/actions.test.ts`
- `pnpm check`
- `pnpm test`
- `git diff --check`

## 风险与回滚点

- 迁移生成/元数据同步是第一回滚点；不得把历史 `false` 回填为 `true`。
- 错误判定若放宽会误伤普通 400；测试必须覆盖“有工具词但不是不支持”和“明确不支持”两类。
- 流式降级只能发生在未提交响应且最多一次；已有文本/推理/工具调用后不得重放。
- 运行时数据库写失败只影响能力学习，不得覆盖上游原错误或导致当前请求失败。
