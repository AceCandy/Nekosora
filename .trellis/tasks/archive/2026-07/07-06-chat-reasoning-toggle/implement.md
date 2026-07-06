# Implement — chat 推理模式开关与强度调节

> 依据 `design.md`（D1–D4）。按依赖顺序实现，每步可独立验证。编号仅为排序，非强制单次提交边界。

## 前置确认（已验证）

- 当前模型的 `capabilities` **未**通过 SSR 传到前端：`app/chat/[id]/page.tsx:42-51` 的 `models` 映射只取 `name/displayName`，丢弃了 capabilities；`ModelOption`（`ChatComposer`）无 capabilities 字段。第 6 步必须补这条数据流（数据源可用——`getVisibleModels()` 返回的 model 行含 capabilities，与 `app/(dash)/panel/models/page.tsx:31` 一致）。

## 实现顺序

- [ ] **1. 后端类型 + 映射核心**（基础，纯新增、无副作用）
  - `src/db/types.ts`：`ThinkingLevel` / `ReasoningLevel` / `ThinkingLevelMap`；`ModelCapabilities.thinkingLevelMap?`；`ComposerState.reasoning?`。
  - `src/lib/providers/types.ts`：`IRRequest.reasoning?: ReasoningLevel`。
  - `src/lib/reasoning.ts`（新）：`DEFAULT_MAP`、`buildReasoningProviderOptions(protocol, caps, level)`、`resolveReasoningLevel(effort)`（网关 effort→内部级别）。
  - 验证：`pnpm typecheck`。

- [ ] **2. `lib/stream.ts` 注入 providerOptions**
  - `streamWithRoute` 的 `streamText` 增 `providerOptions: buildReasoningProviderOptions(route.protocol, route.capabilities, request.reasoning)`（off/无值→不传）。
  - `generateChat`（标题/记忆副任务）保持不传 reasoning。
  - 验证：`pnpm typecheck`；手测 anthropic 模型开「高」，确认上游请求携带 `thinking.budget_tokens`。

- [ ] **3. `app/api/chat/route.ts` 读 composerState.reasoning**
  - 在 temperature 覆盖段（`composerParams` 读取处）增 `if (composerParams.reasoning) irRequest.reasoning = composerParams.reasoning;`。
  - 验证：`pnpm typecheck`。

- [ ] **4. 网关 `app/v1/chat/completions/route.ts` 透传 reasoning_effort**
  - body 解析增 `reasoning_effort`；`resolveReasoningLevel` 转内部级别；`irRequest.reasoning = ...`。
  - 验证：`pnpm typecheck`；`curl` 网关带 `reasoning_effort=high`，确认上游请求携带 providerOptions。

- [ ] **5. 前端 `CapabilitiesEditor` 级别映射编辑器**
  - `caps.reasoning===true` 时展开 low/medium/high 三档 text input（留空=null），写入 `caps.thinkingLevelMap`，随现有 hidden `capabilities` 序列化。
  - 验证：admin 勾 reasoning → 填映射 → 保存 → 重开确认回显；DB `capabilities` 含 `thinkingLevelMap`。无需改 server action。

- [ ] **6. 前端 ReasoningPicker + 数据流 + store + action**
  - **6a SSR 数据流（前置）**：`app/chat/[id]/page.tsx:42-51` 的 `models` 映射补 `capabilities`（globals 取 `m.capabilities`、byos 取 `r.model.capabilities`）；`ModelOption`（`ChatComposer`）增 `capabilities?`；透传到 `ChatToolbar`，使其能拿到「当前选中模型」的 capabilities。
  - **6b ReasoningPicker**：`ChatToolbar.tsx` 新增（参考 `ModelParamsPicker`），按选中模型 `capabilities.reasoning===true` 显隐；档位按 `thinkingLevelMap`（无则默认四档）动态生成。
  - **6c 持久化**：`features/chat/actions/conversations.ts` 的 `setModelParams`（或同类）增 `reasoning` 合并进 composerState；`getConversationComposerState`/SSR 初值透传 `reasoning`。
  - 验证：可推理模型见控件、非推理模型不见；选档发送→刷新后保留；上游请求 providerOptions 正确。

- [ ] **7. i18n（`messages/zh-CN.json`、`en.json`）**
  - 增 `reasoning`、`reasoningOff/low/medium/high`、`thinkingLevelMapHint` 等键。
  - 验证：中英文切换文案正确。

## 验证命令

- `pnpm lint`、`pnpm typecheck`（TS 项目标准质量门槛）。
- 关键路径手测：可推理模型 开/关/调档 + 刷新持久 + 网关 `reasoning_effort`。

## 风险与回滚点

- **核心回滚点**：`buildReasoningProviderOptions` 返回 `undefined` ≡ 未改动。任一步出问题，前端不渲染控件即退回原状；数据字段缺省对旧数据无害。
- **高风险文件**：`lib/stream.ts`（流式核心，streamText 参数）、`app/api/chat/route.ts`（主链路）——改动后必须手测一次完整对话不回归。
- **实现时验证的不确定项**（design §5/§6）：
  - `createOpenAICompatible` 的 `providerOptions` namespace——若不认 `openai.reasoningEffort`，openai-compatible 路径降级为「静默忽略」（符合 D2）。
  - anthropic 启用 thinking 时 `max_tokens` 与 `budget_tokens` 关系——必要时兜底抬高 max_tokens。

## task.py start 前检查

- `prd.md` / `design.md` / `implement.md` 齐全且已通过用户 review。
- 前置确认（当前模型 capabilities 的 SSR 数据流）已落实或纳入第 6 步。
