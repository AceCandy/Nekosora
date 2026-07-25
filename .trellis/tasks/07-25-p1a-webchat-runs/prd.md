# P1-A WebChat runs/tool_calls 接入

## Goal

把现有 `runs` / `tool_calls` / `messages.runId` 接入 WebChat 生成链路，使每次生成有可审计、可刷新不丢的服务端 run 记录。不新增 schema/迁移，不改前端 UI。

## Requirements

1. 每次 WebChat 生成（普通发送、重试、编辑重发、续写）创建唯一 `runId`，流开始前插入 `runs`（`status=running`）。同一 Agent 多轮共享该 `runId`。
2. 把 `runId` 写入本轮新建 user（仅 send）与本轮新建/被续写的 assistant；retry/edit 复用既有 user 时不篡改历史消息归属。
3. `tool-call` 到达写 `tool_calls`（pending/running）；`tool-result` 用 `runId+toolCallId` 更新 success/failed，并保存 `outputJson` 或 `errorJson`。DB 失败不中断模型流，日志不泄露敏感内容。
4. `finish` 后 run 更新为 success 并保存 `tokenUsage`；error/异常/abort/maxSteps 耗尽更新为 failed 或 interrupted；finally 收敛 `running`。
5. SSE 行为保持兼容；服务层限定在 chat/run 生命周期模块；服务层补最小单测。
6. 工具参数/结果做 jsonb 安全规范化；不记录密钥、Authorization、完整模型请求/回复。
7. 不修改前端；不重做 `usage_logs`/`ops_error_logs`。可将 `streamChat` 的 `runId` 与 `runs.runId` 对齐，但不破坏现有日志契约。
8. 遵守 database / mcp / logging guidelines；经 `getDb`/`getSchema` 访问 DB，禁止静态引入 pg 驱动。
9. 保留工作树中已有 P0-A/P0-B 改动，禁止回滚或格式化无关文件。

## Acceptance Criteria

- [x] 普通/重试/编辑重发/续写均创建 run 且 status 从 running 收敛到终态
- [x] Agent 多轮共享同一 runId，并传给 streamChat
- [x] 新建 user/assistant 带 runId；retry/edit 不改历史 user.runId；续写更新目标 assistant.runId
- [x] tool-call/tool-result 正确落库；DB 失败不阻断流
- [x] finish → success+tokenUsage；error/abort/maxSteps → failed/interrupted
- [x] 相关 Vitest 通过；`git diff --check` 通过；不跑全量 build

## Notes

- 不新增 schema/迁移；不改前端。
- usage_logs 多轮多条契约保持（P0-B 已测）。
