# Chat 会话级生成参数与推理控制

> WebChat 会话级生成参数(temperature/topP/maxTokens/reasoning)的端到端契约,以及上游 reasoning/thinking 参数的下发。新增同类参数时按此契约扩展。

---

## Scenario: 新增一个会话级生成参数

### 1. Scope / Trigger
- Trigger: 新增影响上游生成的、随会话持久化的参数(如 reasoning 级别;未来可能的 top_k / frequency_penalty 等)。属于 cross-layer 契约改变:`ComposerState` 字段 + `IRRequest` 字段 + 上游 `providerOptions`。

### 2. Signatures
- DB 类型:`ComposerState`(`src/db/types.ts`)加可选字段;JSON 列无需迁移。
- IR 中间表示:`IRRequest`(`src/lib/providers/types.ts`)加可选字段(其 `[key:string]:unknown` 兜底已允许透传)。
- 前端持久化:普通参数走 `setConversationModelParams`;推理档位走 `setConversationModelReasoning(convId, modelId, level)`，写入 `reasoningByModelId`。
- 后端读取:`app/api/chat/route.ts` 的 `composerParams` 段,从 `conv.composerState` 读后覆盖 `irRequest`。
- SSR 回填:`getConversationComposerState` 返回该字段 + `app/chat/[id]/page.tsx` 的 `initialXxx` prop + `ChatComposer` 本地状态。

### 3. Contracts
- 推理档位包含 `off`，按具体 `modelId` 保存；切换模型时恢复该模型在当前会话中的选择。
- 已有会话从 `composerState` 读取；新会话首次发送时通过创建选项把当前 `modelId + level` 一并写入，保证首轮生效。
- 上游专属参数走 AI SDK **请求级 `providerOptions`**,不走 provider 构造级(`createOpenAI`/`createAnthropic` 等)。因为每请求的值可能不同,且 provider 实例每次按路由/key 新建。

### 4. Validation & Error Matrix
- composerState 字段被篡改为非法值 → route 读取处用类型守卫忽略(如 `typeof x === "number"`)。
- reasoning 级别该模型不支持时，按完整档位顺序夹到最近可用档。
- OpenAI-compatible 不复用 `openai` namespace，按模型目录 `thinkingFormat` 转换最终请求体。
- anthropic 启用 thinking 时若 `max_tokens ≤ budget_tokens` → 必要时在翻译处抬高 max_tokens 兜底。

### 5. Good/Base/Bad Cases
- Good:模型 `capabilities.reasoning===true`,用户选 high → 上游请求携带对应 `providerOptions`,思考过程经既有 SSE `reasoning` 链路展示。
- Base:非推理模型 → 工具栏不露控件,上游请求与普通对话逐字节一致。
- Bad:某级被该模型声明为不支持 → 夹到最近可用档，绝不把无效档位发送给上游。

### 6. Tests Required
- 覆盖完整档位、默认选择、最近档夹取、固定推理、Anthropic budget/adaptive、Gemini budget/level 和各 compatible `thinkingFormat`。
- 网关 `resolveReasoningLevel` 保留 `minimal/low/medium/high/xhigh/max`，`none` 映射为 `off`。

### 7. Wrong vs Correct
#### Wrong
- 把 reasoning 级别塞进 `streamText` 顶层参数(AI SDK 不认)。
- 在 provider 构造级(`createOpenAI`/`createAnthropic`)配置 reasoning(reasoning 是请求级)。
- 把推理档位保存成会话全局单值，导致切换模型后串档。
#### Correct
- 走 `streamText` 的 `providerOptions`,由 `lib/reasoning.ts` 按 `protocol`+`capabilities` 翻译。
- 前端按 `modelId` 调用 `setConversationModelReasoning`；新会话创建时同时写入首个模型档位。

---

## Convention: per-model 能力映射(thinkingLevelMap)

推理档位使用完整集合 `off/minimal/low/medium/high/xhigh/max`。Chat 从模型目录动态读取可用档位；`null` 明确禁用档位，`xhigh/max` 必须显式映射才可用。会话通过 `composerState.reasoningByModelId` 按具体模型保存选择，默认优先 `off`，不能关闭时使用最低可用档。

`thinkingFormat` 归属于模型目录，不按 route/provider URL 推断。OpenAI-compatible 请求体按该字段编码；`fixed` 表示模型固定推理且不发送控制参数。请求档位失效时使用与 pi 相同的最近可用档夹取规则。

Agnes 的 OpenAI-compatible 接口使用 `chat_template_kwargs.enable_thinking` 布尔开关；不能复用 Qwen 的 `preserve_thinking` 扩展参数。Anthropic protocol 仍按目录预算映射生成 `thinking.budget_tokens`。

**What**:模型的 `capabilities` JSON 可存 `thinkingLevelMap`(统一级别→供应商值,`null`=该级不支持);后端按 `protocol` 给默认 map,模型可覆盖。

**Why**:不同供应商的 reasoning 参数形态不同(openai=effort 字符串、anthropic/gemini=token 数),且同一 protocol 下不同模型支持的级别可能不同。per-model 映射让「统一级别」与「供应商具体值」解耦,借鉴 earendil-works/pi。

**Example**:
```ts
// lib/reasoning.ts:per-model map 优先,null=不支持;否则回退 protocol 默认
const v = capabilities?.thinkingLevelMap?.[level] ?? DEFAULT_MAP[protocol]?.[level];
```

**相关**:`src/lib/reasoning.ts`(`DEFAULT_MAP` + `buildReasoningProviderOptions` + `resolveReasoningLevel`)是推理映射的唯一中枢。
