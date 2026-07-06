# chat 推理模式开关与强度调节

## Goal

让用户在 WebChat 界面对「后台已标记为可推理」的模型，能够**开启/关闭推理并调节强度**，设置随会话持久化、实际下发上游生效；admin/panel 可 per-model 配置级别映射；对外网关同步支持 `reasoning_effort`。

当前 chat 侧无法控制推理——思考过程只能被动展示，`capabilities.reasoning` 能力位是死数据，上游请求不传任何 reasoning 参数。

## Background（代码确认的事实）

- **能力位闲置**：`ModelCapabilities.reasoning` 定义于 `src/db/types.ts:11`，存于 `capabilities` JSON 列（`db/schema/pg.ts:165,227`、`db/schema/sqlite.ts:131,196`），admin/panel 表单可勾（`features/models/CapabilitiesEditor.tsx:13`）、server action 持久化（`app/(dash)/admin/actions.ts:231-242,276-292`、`app/(dash)/panel/actions.ts:302-314,324-337`），但路由/stream/provider 零消费（对照 `vision` 在 `lib/chat/orchestrator.ts:110-117` 被校验）。
- **展示链路完整（本次不动）**：SSE `reasoning` 事件 → `chatStreamStore` 累积 → 落库 `messages.reasoning` → `ChatMessageItem.tsx:223-277` 渲染。
- **上游不传 reasoning**：`streamText`（`lib/stream.ts:196-205`）无 `providerOptions`；四 protocol 在 `lib/providers/registry.ts:36-78` 构造，reasoning 应走**请求级** `providerOptions`（AI SDK v5 标准），而非 provider 构造级。
- **会话级持久化现成可复用**：`temperature/topP/maxTokens` 走 `conv.composerState`——前端 `setModelParams`（`features/chat/actions/conversations.ts:222-245`）写、后端 `app/api/chat/route.ts:185-189` 读；`ModelParamsPicker`（`ChatToolbar.tsx:346-402`）是 UI 入口。推理设置复用此路径。
- **网关当前丢弃 `reasoning_effort`**：`/v1/chat/completions`（`app/v1/chat/completions/route.ts:48-56`）只取 `model/messages/stream/temperature/max_tokens/top_p/stop`。
- **参考 pi**（`/tmp/pi-ref`，earendil-works/pi `packages/ai`）：`ThinkingLevel=minimal/low/medium/high/xhigh`+`off`、`thinkingLevelMap`、`thinkingBudgets`、`compat.thinkingFormat`（`src/types.ts:74-76,88,291,672,677,490-501`）。借鉴其 **per-model 元数据驱动**思路；不照搬 `thinkingFormat` 编码（本项目 AI SDK `providerOptions` 已覆盖官方 openai/anthropic/google 三家）。

## Decisions

- **D1** 强度档位 = 统一四档「关 / 低 / 中 / 高」。
- **D2** 映射策略 = per-model 元数据驱动（借鉴 pi）：`capabilities` 扩展 `thinkingLevelMap`（统一级别→供应商值，`null`=不支持），后端按 protocol 给默认 map、模型可覆盖；前端按 `capabilities.reasoning===true` 显隐控件、级别选项按 map 动态生成；openai-compatible 模型配了 map 才传 reasoning。
- **D3** MVP 即在 admin/panel 的 `CapabilitiesEditor` 暴露 per-model 级别映射编辑 UI。
- **D4** 对外网关 `/v1/chat/completions` 同步支持 `reasoning_effort`（OpenAI 标准 `minimal/low/medium/high` → 内部统一级别 → 复用 providerOptions 映射）。

## Requirements

- R1：WebChat 工具栏对 `capabilities.reasoning===true` 的模型露出推理控件；级别选项按该模型的 `thinkingLevelMap` 动态生成（只列非 null 的档），非推理模型不露出。
- R2：推理设置（开关 + 级别）随会话持久化（写入 `composerState`），切换会话/刷新后保留。
- R3：`capabilities` 扩展 `thinkingLevelMap`（统一级别→供应商值，`null`=不支持）；admin/panel 的 `CapabilitiesEditor` 在勾选 reasoning 后展开级别映射编辑器（每档可填供应商侧值，留空=不支持）。
- R4：后端从 composerState 读取推理级别，结合模型的 `thinkingLevelMap`（缺省按 protocol 默认 map）算出供应商值，经 IRRequest 传到 `streamText` 的 `providerOptions` 下发上游：openai→`reasoningEffort`、anthropic→`thinking.budget_tokens`、gemini→`thinkingConfig.thinkingBudget`。
- R5：对外网关 `/v1/chat/completions` 从 body 读 `reasoning_effort`，转内部级别后复用 R4 的映射链路。

## Acceptance Criteria

- [ ] admin/panel：模型勾选 reasoning 后可编辑级别映射；保存后 `capabilities` 含 `thinkingLevelMap`。
- [ ] WebChat：对 `capabilities.reasoning===true` 的模型露出控件，级别选项按 map 动态生成；非推理模型不可见。
- [ ] 选级别后发送，上游请求 `providerOptions` 含正确的供应商参数（openai/anthropic/gemini 各按 map）。
- [ ] 关闭推理（off）时，上游请求不带 reasoning 参数。
- [ ] 切换会话/刷新，推理设置保留。
- [ ] openai-compatible 模型未配 map 时不传 reasoning、不报错；配了 map 则按值传。
- [ ] 网关 `/v1/chat/completions` 带 `reasoning_effort` 时，上游请求 `providerOptions` 正确携带；不带时行为不变。

## Out of Scope

- 思考过程展示链路的改动（已完整）。
- reasoning 用量的计费/配额逻辑（`reasoningTokens` 已记录，本次不扩展）。
- pi 的 `minimal`/`xhigh` 两档（MVP 用四档；数据结构按 pi 的 `ModelThinkingLevel` 预留扩展）。
