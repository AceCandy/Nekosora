# Design — chat 推理模式开关与强度调节

> 对应 `prd.md`，决策 D1–D4。借鉴 pi（`/tmp/pi-ref`）的 per-model 元数据驱动思路，编码层走 AI SDK v5 `providerOptions`。

## 1. 架构与边界

整体沿用现有「composerState 会话级持久化 + IRRequest 中间表示 + streamText 请求级参数」骨架，新增一个**统一推理级别**维度，在 stream 层翻译为各供应商 `providerOptions`。

```
admin/panel 表单            WebChat 工具栏
  CapabilitiesEditor          ReasoningPicker（新）
  ├ reasoning ☐               ├ 显隐: caps.reasoning===true
  └ 级别映射(新)              └ 档位: caps.thinkingLevelMap 动态生成
        │ 写 caps JSON              │ 写 composerState.reasoning
        ▼                            ▼
  capabilities 列           conversations.composerState
        │                            │ route.ts 读(同 temperature 路径)
        ▼                            ▼
  ResolvedRoute.capabilities ──► irRequest.reasoning(统一级别)
        │                            │
        └────────────┬───────────────┘
                     ▼
        lib/reasoning.ts(新)  buildReasoningProviderOptions(protocol, caps, level)
                     │
                     ▼
        streamText({ ..., providerOptions })
```

**不改动**：思考展示链路（SSE reasoning 事件 / store 累积 / ChatMessageItem 渲染）、server action 的 capabilities 持久化（已整体 JSON.parse）、provider registry（reasoning 是请求级，不走构造级）。

## 2. 数据契约

### 2.1 统一级别（新，`src/db/types.ts` 顶部）

```ts
/** 推理强度档位（对齐 pi ThinkingLevel 子集，预留 minimal/xhigh 扩展）。 */
export type ThinkingLevel = "low" | "medium" | "high";
/** 含「关闭」。 */
export type ReasoningLevel = "off" | ThinkingLevel;
/** per-model 级别→供应商值（字符串，语义随 protocol：openai=effort、anthropic/gemini=token 数）。null/缺省=该档不支持。 */
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;
```

### 2.2 类型扩展

- `ModelCapabilities`（`db/types.ts:6`）增 `thinkingLevelMap?: ThinkingLevelMap`。
- `ComposerState`（`db/types.ts:29`）增 `reasoning?: ReasoningLevel`。（temperature/topP/maxTokens 既有类型缺失属既存问题，不在本次范围，仅注释提示。）
- `IRRequest`（`lib/providers/types.ts:81`）增 `reasoning?: ReasoningLevel`（显式字段；`[key:string]:unknown` 兜底仍在）。

### 2.3 默认级别映射（新，`src/lib/reasoning.ts`）

模型未配 `thinkingLevelMap` 时按 protocol 回退。值取字符串，翻译时按 protocol 解释：

| protocol | low | medium | high | AI SDK 出口 |
|---|---|---|---|---|
| openai | `"low"` | `"medium"` | `"high"` | `providerOptions.openai.reasoningEffort` |
| anthropic | `"4096"` | `"16384"` | `"32768"` | `providerOptions.anthropic.thinking={type:"enabled",budget_tokens:Number(v)}` |
| gemini | `"2048"` | `"8192"` | `"24576"` | `providerOptions.google.thinkingConfig={thinkingBudget:Number(v)}` |
| openai-compatible | —（无默认） | — | — | 仅当 per-model 配了 map 才下发 |

> 默认 token 数值是起点，可在 `lib/reasoning.ts` 集中调；admin 也可 per-model 覆盖。

### 2.4 翻译规则（`buildReasoningProviderOptions`）

输入 `(protocol, capabilities, level)`，输出 `providerOptions` 对象或 `undefined`：
1. `level==="off"` 或缺省 → `undefined`（不传，回归普通对话）。
2. 取值：`v = capabilities.thinkingLevelMap?.[level] ?? DEFAULT_MAP[protocol]?.[level]`。
3. `v` 为 null/空 → `undefined`（该档不支持，静默忽略）。
4. 按 protocol 编码（见上表）。anthropic/gemini 的 v 用 `Number(v)` 转 token；NaN 则忽略。
5. openai-compatible：仅当模型配了 `thinkingLevelMap` 且该档有值才下发；下发 namespace 走 `openai`（与 registry.ts:52 用 `createOpenAICompatible` 一致；实现时验证 AI SDK 对 compatible provider 的 `providerOptions` namespace，若不认 `reasoningEffort` 则该路径降级为「配了也无法下发、静默忽略」，符合 D2）。

## 3. 关键改动点（概念定位，非行号）

**后端**
- `lib/reasoning.ts`（新）：统一级别类型 re-export、DEFAULT_MAP、`buildReasoningProviderOptions`、`resolveReasoningLevel`（网关 effort→内部级别）。
- `lib/stream.ts`：`streamWithRoute` 的 `streamText` 调用增 `providerOptions: buildReasoningProviderOptions(route.protocol, route.capabilities, request.reasoning)`；`streamChatWithTools` 透传 `request.reasoning`（已通过 `{...opts.request}` 自然带过）。`generateChat`（标题/记忆副任务）**不传** reasoning，保持现状。
- `app/api/chat/route.ts`：`composerParams` 读取处（现 temperature 覆盖段）增 `if (composerParams.reasoning) irRequest.reasoning = composerParams.reasoning;`。
- `app/v1/chat/completions/route.ts`：body 解析增 `reasoning_effort`，`resolveReasoningLevel` 转内部级别后 `irRequest.reasoning = ...`。

**前端**
- `features/models/CapabilitiesEditor.tsx`：`caps.reasoning===true` 时展开「级别映射」编辑器（low/medium/high 三档，每档一个 text input，留空=null），写入 `caps.thinkingLevelMap`，随现有 hidden `capabilities` 序列化提交。无需改 server action。
- `features/chat/components/ChatToolbar.tsx`：新增 `ReasoningPicker`（参考 `ModelParamsPicker` 模式），仅当当前模型 `capabilities.reasoning===true` 时渲染；档位选项按模型的 `thinkingLevelMap`（无则用默认四档）动态生成；选中值经 `setModelParams`-类 action 写入 `composerState.reasoning`。
- `features/chat/actions/conversations.ts`：`setModelParams`（或同类）增写 `reasoning` 字段合并进 composerState；`getComposerState`/SSR 初值（`app/chat/[id]/page.tsx:122` 附近）透传 `reasoning` 给 ChatToolbar。
- chat 页面 SSR 需把当前模型的 `capabilities` 传给 ChatToolbar（用于显隐 + 级别选项）——确认 `globals`/`byos` 模型列表是否已带 capabilities，缺则补。

**i18n**（`messages/zh-CN.json`、`en.json`）：增 `reasoning`（推理）、`reasoningOff/low/medium/high`、`thinkingLevelMapHint` 等键。

## 4. 兼容性与迁移

- `capabilities` 是 JSON 列，加 `thinkingLevelMap` **无需迁移**——旧数据无此键，按 protocol 默认 map 回退。
- `composerState` 同理，`reasoning` 缺省=`off`，旧行为不变。
- `IRRequest.reasoning` 缺省=不传 providerOptions，上游请求与现状逐字节一致。
- 网关 `/v1/chat/completions` 不带 `reasoning_effort` 时行为不变。

## 5. 取舍

- **map 值统一用字符串**（而非 pi 的 string+number 双字段）：per-model 编辑器只需一种输入框；anthropic/gemini 的 token 数后端 `Number()` 转。代价：用户可能填错类型，靠"NaN 则忽略"兜底。
- **off 档不进 map**：off 永远=不传，无需配置。
- **openai-compatible 无默认 map**：避免给陌生兼容上游盲目下发导致 400；用户需要时 per-model 配（D2/D3）。

## 6. 风险与回滚

- 风险：AI SDK 对 `createOpenAICompatible` 的 `providerOptions` namespace 不确定——若 openai-compatible 路径无法下发，降级为静默忽略（不报错），不影响主流程。
- 风险：anthropic `thinking` 启用后，部分旧版 Claude 模型可能要求 `max_tokens > budget_tokens`——翻译时若 `irRequest.max_tokens` 存在且 ≤ budget，取 `max(budget+1024, max_tokens)` 兜底（实现时验证）。
- 回滚：所有改动新增字段缺省即旧行为；`buildReasoningProviderOptions` 返回 undefined 等价于未改动。回滚只需前端不渲染控件（数据保留无害）。
