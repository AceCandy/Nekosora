# 并行执行同批联网搜索

## Goal

并行执行同一模型步骤内相互独立的 web_search 调用，保留每条搜索的后端回退顺序与工具调用顺序。

## Background

- `streamChatWithTools` 当前对同一轮模型产生的所有工具调用使用串行 `await`，导致多个独立搜索的延迟累加。
- 单条 `web_search` 内部的 GPT/模型/外部 Provider 回退链仍必须按配置顺序串行执行。
- 后续 Agent 轮次依赖前一轮工具结果，不能跨轮提前执行。

## Requirements

- 同一模型步骤内，只有全部为内置 `web_search` 的调用批次才允许并行执行。
- 同批 `web_search` 的每条调用继续独立执行完整的后端回退链，不能共享或跳过用户配置的优先级。
- 工具结果事件和回填给模型的 `tool` 消息必须保留模型原始调用顺序，避免响应与 `tool_call_id` 错配。
- MCP 工具与 `web_search` 混合出现时保持现有串行行为。
- 继续透传取消信号；单个搜索失败只影响该调用，不得取消同批其他搜索。
- 不新增配置项、数据库字段或前端展示逻辑。

## Acceptance Criteria

- [x] 同批不超过三个 `web_search` 时执行时间接近最慢调用；超过三个时按每批最多三个执行。
- [x] 同批搜索的 `tool-result` 事件和下一轮 `tool` 消息按原始调用顺序排列。
- [x] 混合 MCP 与 `web_search` 的批次仍按原顺序串行执行。
- [x] 一个搜索失败时，同批其他搜索仍完成并回填结果。
- [x] 相关 Agent loop 单元测试通过。

## Out of Scope

- 不并行单条搜索内部的后端回退。
- 不跨模型 Agent 轮次并行工具调用。
- 不改变搜索后端优先级、超时或 UUID 展示。

## Risks

- 同批搜索会增加瞬时上游并发和费用；并行范围仅限模型明确同时发出的独立 `web_search` 调用。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
