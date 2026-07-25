# 后台任务模型配置与 Chat 完成时序优化

## Goal

消除标题生成对 Chat 完成状态的阻塞，同时让标题生成、上下文摘要和 Mem0
记忆抽取能够从已配置模型中选择各自使用的模型，保证后台任务失败或变慢时
不影响主回答的完成与持久化。

## Background

- `route.ts:316-417` 当前先发送 `[DONE]`，随后在 `finally` 中保存 assistant
  消息、提取 Artifact、清除 `generating`，并同步 `await maybeGenerateTitle()`，
  最后才关闭 SSE。
- `sse.ts:83-96` 当前忽略 `[DONE]`，前端必须等待网络 EOF 才结束
  `streaming`，因此标题模型延迟会表现为 Chat 持续生成。
- 管理端已经存在三个设置键：`task.title_model`、`task.compact_model`、
  `rag.mem0_llm_model`；当前 UI 都是自由文本输入，并非从已配置模型中选择。
- 标题、摘要和 Mem0 抽取都应复用 Nekosora 的统一模型执行核心；该核心负责
  将模型路由到 Anthropic、Gemini、OpenAI-compatible 等上游协议。
- Embedding 仍单独使用 `rag.embedding_provider_id` + `embedding_model`；它只
  负责向量化，不作为 Mem0 LLM 的连接来源。

## Requirements

### R1 Chat 完成时序

- `[DONE]` 必须只在 assistant 消息和必要会话状态持久化完成后发出。
- 前端收到可靠的 `[DONE]` 后结束当前回答的流式状态，不再等待标题生成。
- 用量日志、assistant 消息、Artifact 和 `generating=false` 的现有数据语义不得丢失。

### R2 标题后台化

- 首条用户消息落库后，将标题生成提交到 pg-boss 后台队列，Chat 请求不等待标题结果。
- 标题仍只根据首条用户消息生成；失败时保留基于首条消息的临时标题。
- 最终标题只可覆盖“新会话”或本轮临时标题，不得覆盖用户手动改名。
- 标题静默写库，不新增实时轮询或独立推送；后续刷新或导航时同步最终标题。

### R3 后台模型选择

- 管理端为标题、摘要、Mem0 抽取提供可选择的已配置模型控件，保存模型 ID，
  继续兼容旧的模型名设置并清除对应运行时缓存。
- 标题任务读取 `task.title_model_id`，摘要读取 `task.compact_model_id`，Mem0
  读取 `rag.mem0_llm_model_id`；旧的 `*_model` 名称键仅作兼容回退，不得由
  Chat 请求临时传入模型覆盖后台配置。
- 已失效或不可用的配置必须有明确的回退或静默失败行为，不能阻断 Chat。

### R4 质量与兼容

- 保持现有会话标题、上下文压缩和 Mem0 数据兼容，不新增无必要的数据库迁移。
- 补充队列标题任务、标题条件更新、SSE 完成顺序、三个配置读取/保存路径的测试。
- 实现与最终复核分离，业务代码由 `@Grok` 实现，主代理负责设计、边界交接和验收。

## Acceptance Criteria

- [ ] 首轮 Chat 的正文生成结束后，不再等待标题模型请求才结束生成状态。
- [ ] `[DONE]` 到达时 assistant 消息已可被重试、删除和续写流程查询。
- [ ] 标题任务由 worker 消费；worker 未运行或标题生成失败不影响 Chat 成功完成。
- [ ] 用户手动修改标题后，迟到的后台标题不会覆盖用户标题。
- [ ] 标题、摘要和 Mem0 抽取模型均通过管理端选择并分别生效。
- [ ] 清空配置时，各后台任务按设计回退或静默跳过，不影响主回答。
- [ ] 相关定向测试、类型检查和 lint 通过；若受环境限制未运行，交付时明确列出。

## Out of Scope

- WebSocket、独立标题 SSE 或标题完成后的实时推送。
- 改变标题 Prompt、摘要算法、Mem0 记忆策略和十分钟频率保护。
- 重构通用模型目录、路由协议或 Provider 管理体系。

## Technical Notes

- 三个模型选择器统一从已启用且可通过 `resolveRoutesById` 访问的公共模型中
  选择；Mem0 通过统一执行核心调用所选模型，不再绑定 Embedding Provider。
- 后台 Worker 独立于 Next.js 进程，任务执行时必须重新核对模型设置，不能只
  依赖管理端保存动作触发的进程内缓存重置。
