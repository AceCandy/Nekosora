# 统一聊天过程轨迹

## Goal

把聊天回复正文前的真实准备过程、模型推理、MCP/普通工具、Web Search 和来源引用收敛成一条连续、可信、可恢复的过程轨迹。用户发出消息后立即获得明确反馈；首个正文出现时，过程面板按真实状态完成并自然让位给正文，而不是依赖组件猜测。

核心用户价值：

- 消除上下文准备期间的无反馈等待。
- 不再把 Web Search、推理和工具结果拆散展示。
- 刷新、切换版本和中断后仍能看到同一份已发生过程。
- 保持 Nekusora 当前严格的运行终态、取消、搜索来源和网关故障转移契约。

## Background

- `/api/chat` 当前在建立 SSE 前同步完成 `prepareChatContext`，所以附件、记忆、压缩、RAG、模板和指令卡阶段无法实时展示。
- 后端已有 `ProcessTrace`，包含 Prompt blocks、token 估算、消息数量和 Web Search 调用，但前端历史投影主要消费 Web Search。
- 当前工作树的 `MessageProcessTrace` 已把 reasoning、tool、Web Search 和来源放进同一容器，但没有真实准备状态，且用整轮 `isStreaming` 代替过程阶段。
- 当前 Chat SSE 已有严格的 `finish -> terminal(success) -> [DONE]` 契约；失败和中断不能伪装成成功。
- 网关已经拥有“输出不可撤回事件前允许故障转移，输出后禁止换路由”的契约，本任务不得另写一套重试系统。

## Requirements

### R1. 单一事实来源

- 在 `@nekusora/contracts` 定义版本化的聊天过程事件和最终快照；后端、SSE、store、历史投影和 UI 复用同一契约。
- 每个事件必须带 `runId`、run 内单调 `seq`、阶段和服务端时间；步骤更新还必须带 run 内稳定的 `stepId`、步骤类型和状态。
- 一个集中 reducer 同时负责实时事件归并和历史快照恢复；组件不得自行重新解释原始 SSE 或数据库 JSON。

### R2. 真实正文前进度

- 保留鉴权、请求格式、会话属主、分支关系、附件属主和视觉能力等 HTTP preflight；这些失败继续返回正确的 4xx/5xx，而不是伪装成流内成功。
- preflight 完成后尽早建立 SSE、确认 run 并发送 `preparing`；耗时的附件处理、记忆、压缩、RAG、模板/指令卡和 Prompt 规划在流内执行并发出实际阶段事件。
- 保留 `prepareChatContext` 当前可并行步骤的并行度，不得为了事件顺序退化为串行。
- 降级步骤必须显示 `skipped` 或安全的失败原因；硬失败不得调用上游模型。

### R3. 首正文门控

- 第一个非空正文 delta 前，必须先发送过程阶段从准备/思考切换到 `answering` 的事件。
- 模型 reasoning 与可见正文继续严格分离；空 delta 不触发正文门控。
- 工具或搜索发生在正文前时，过程面板保持展开；正文开始后不因后续步骤强制抢回焦点。

### R4. 统一过程内容

- 单一面板将真实事件投影为面向用户的“理解、上下文、分析、搜索、阅读、整理答案”；Prompt 构建、隐藏推理、原始工具名/参数和 provider 尝试路径不得直接展示。
- Web Search 的 backend、attempt path、状态和 citations 保留现有精细结构，不再存在独立的搜索过程容器。
- 默认只显示当前动作或完成摘要；展开后仍只显示用户语义时间线。来源作为独立信息区展示，不作为执行步骤；token、Prompt 和工具调试信息不进入该组件。
- 不向过程事件或快照复制完整 system prompt、记忆原文、隐藏指令、原始 provider 错误、密钥、任意工具参数/结果或完整 reasoning。

### R5. 持久化与兼容

- 在现有 `messages.processTrace` JSONB 中保存版本化最终快照，并保留现有 blocks 和 `webSearch.calls`。
- success、failed、interrupted 都要保存已经发生的安全轨迹；continue 必须追加而不是覆盖原 assistant 的历史搜索/轨迹。
- 同一 assistant 的多次 continue 必须按 run 分组保存；不同 run 的 `seq/stepId` 不得冲突或互相覆盖。
- 旧消息没有新快照时，从现有 reasoning/toolCalls/searchResults 派生只读兼容视图；不得伪造运行中状态或虚构准备步骤。
- 新 SSE 事件必须是增量兼容的：旧客户端可忽略，新客户端仍可消费旧服务端事件。

### R6. 状态与交互

- 状态至少覆盖 `preparing`、`processing`、`answering`、`completed`、`failed`、`interrupted`。
- 新生成默认收起完整时间线，只在摘要中实时显示当前动作；运行转为终态时自动收起一次，终态后用户可手动展开。
- 错误和中断保留已生成正文及已完成步骤，不能清空轨迹或显示成功勾选。
- 历史完成消息默认收起；切换分支/版本时不得串用另一版本的步骤、工具或来源。

### R7. 体验与无障碍

- 使用“星枢天流”现有 token、语义字号和 8px 以内圆角；静止态无投影，不使用嵌套卡片、彩色侧条或装饰性动效。
- 过程面板是一条紧凑的可披露活动流，不是新的重型卡片；正文仍是视觉主角。
- 动态摘要使用克制的 `aria-live=polite`，不得逐 token 播报 reasoning 或正文。
- 键盘焦点可见，状态不只依赖颜色，coarse pointer 触控目标不小于 44px。
- 支持亮/暗主题、`prefers-reduced-motion`，并在 320/390/768/1280px 下无横向溢出或滚动锚点跳动。

### R8. 性能与可靠性

- trace 只发送阶段/步骤状态变化，不为每个正文或 reasoning token 生成额外 trace 事件。
- `seq` 只由后端 recorder 分配；并行步骤通过稳定 `stepId` 更新，前端按 reducer 幂等归并。
- 不改变现有 run 终态 latch、heartbeat、完成事务、Abort 和网关故障转移边界。
- trace 记录失败不得让已可用的模型回答失败；必须降级到现有 SSE/历史能力并留下可诊断但不泄密的内部日志。
- 记录安全的 time-to-first-trace、prepare duration、first-content latency、事件数和 emit failure 指标；禁止把 query、Prompt、记忆、工具参数或错误原文作为日志/指标维度。

## Out of Scope

- 让生成在刷新、关闭标签页或客户端断开后继续运行。
- Redis Stream、持久事件日志、`afterSeq` 断线续流或跨进程订阅；这些依赖后台生成语义，另立任务。
- 新增路由故障转移、非流式 fallback 或复制网关 execution engine。
- 暴露原始 Prompt、记忆内容、隐藏 reasoning、任意工具输入输出或 provider 错误。
- 新建通用工作流/DAG 引擎、管理后台 trace 检索或跨 run 分析。
- 引入新的状态管理、动画、UI 组件或样式依赖。

## Acceptance Criteria

- [ ] 用户发送后，在任何模型调用前看到“正在准备”及真实步骤；不存在只有空白 spinner 的长等待。
- [ ] 附件、记忆、压缩、RAG、Prompt、reasoning、MCP/工具、Web Search 和来源按实际事件顺序进入同一面板。
- [ ] 首个非空正文 delta 前必有 `answering` 事件；面板只在该边界自动收起一次。
- [ ] Web Search 不再单独展示，backend/attempt/citations 在统一面板中保持实时与刷新后一致。
- [ ] success、failed、interrupted 刷新后都恢复正确轨迹；旧消息无新快照时正常降级显示。
- [ ] send、regenerate、edit-and-resend、continue 四条生成路径使用同一事件投影和状态机。
- [ ] prepare 硬失败不调用模型；Abort、自然 EOF、持久化失败保持既有 terminal/DONE 语义。
- [ ] continuation、分支和版本切换不覆盖或串用其他 run 的步骤和来源。
- [ ] 同一 assistant 连续续写两次后，三个 run 的步骤按时间保留且各自 seq 从本 run 独立计算。
- [ ] 使用含敏感 sentinel 的 Prompt、记忆、工具参数和 provider 错误进行测试，SSE 与 `processTrace` 均不出现 sentinel。
- [ ] trace 事件数量与步骤状态变化同阶，不随正文/reasoning token 数线性增长。
- [ ] 单元/集成测试覆盖契约、reducer、事件顺序、失败/中断、历史 round-trip 和兼容路径。
- [ ] 浏览器验证覆盖桌面/手机、亮/暗主题、键盘、reduced motion、长查询/URL、滚动锚点和首正文自动收起。
- [ ] `pnpm check`、`pnpm test`、相关 package typecheck、`pnpm build`、`git diff --check` 全部通过。

## Key Decisions

- 默认摘要、按需详情；隐私边界高于“展示所有内部信息”。
- 共享契约 + 单 reducer，而不是在 route、store、组件各自拼一套状态。
- 复用 `messages.processTrace` 最终快照；本任务不新增事件表或 Redis 强依赖。
- 先保留 HTTP preflight，再把无副作用的耗时准备移入流；不牺牲错误语义换取假进度。
- 复用现有 gateway failover、run lifecycle、tool_calls 和 Web Search 投影，不复制能力。

## Open Questions

无阻塞问题。用户已要求按最佳实践给出方案；以上决策以可靠性、隐私和可维护性优先。
