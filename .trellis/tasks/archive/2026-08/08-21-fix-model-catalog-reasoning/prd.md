# 修复模型目录推理能力一致性

## Goal

修复模型目录推理能力、迁移和同步测试闸门

## Requirements

- `model_catalog` 继续作为模型能力和推理语义的唯一事实来源。
- 修复当前 271 条 `reasoning=true` 但缺少 `thinkingFormat` 的目录数据。
- 只有官方资料、官方直连 API 语义或 `pi.dev/api/models` 的明确元数据可以证明推理格式；不得按模型名、厂商名或 Provider URL 猜测。
- 官方原生 OpenAI、Anthropic、Google API 可按其 API 协议映射为 `openai`、`anthropic`/`anthropic-adaptive`、`google`；兼容接口只接受 pi 明确提供的合法格式。
- 证据不足的条目必须移除完整 reasoning bundle，不再向 Chat 暴露假档位。
- `xhigh`、`max` 只有显式映射时可用；`reasoningEffort` 只在上游明确支持独立强度字段时设置。
- 同步 planner 必须拒绝 `reasoning=true` 且缺少合法 `thinkingFormat` 的最终状态。
- 使用新增 PostgreSQL 数据迁移更新已有数据库，并同步 Drizzle journal/snapshot；不得修改已发布 `0000_baseline`。
- 不新增模型，不调整与推理无关的能力、价格和路由。

## Acceptance Criteria

- [ ] 将 baseline 与新增迁移合并后的目录中，不存在 `reasoning=true` 且缺少合法 `thinkingFormat` 的条目。
- [ ] 未经明确证据的模型不显示推理档位，也不发送伪造控制参数。
- [ ] 已确认的 OpenAI、Anthropic、Google 原生模型使用对应官方请求语义。
- [ ] 同步 planner 对完整 bundle 接受，对缺格式、非法格式和聚合器参考数据拒绝或降级。
- [ ] PostgreSQL 迁移可重复执行且只更新目标模型能力字段。
- [ ] Drizzle journal、snapshot 与迁移编号一致。
- [ ] reasoning、sync 和 model catalog 相关测试通过。

## Notes

- 官方 OpenAI API 规范明确 `reasoning_effort` 支持的总枚举，但同时说明不同模型支持集合不同，因此仍以逐模型映射为准。
- 当前 pi 数据中原生 API 模型可能没有 `compat.thinkingFormat`；原生 API 协议本身是格式证据，兼容 API 不是。
