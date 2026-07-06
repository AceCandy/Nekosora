# Chat 会话级生成参数与推理控制

> WebChat 会话级生成参数(temperature/topP/maxTokens/reasoning)的端到端契约,以及上游 reasoning/thinking 参数的下发。新增同类参数时按此契约扩展。

---

## Scenario: 新增一个会话级生成参数

### 1. Scope / Trigger
- Trigger: 新增影响上游生成的、随会话持久化的参数(如 reasoning 级别;未来可能的 top_k / frequency_penalty 等)。属于 cross-layer 契约改变:`ComposerState` 字段 + `IRRequest` 字段 + 上游 `providerOptions`。

### 2. Signatures
- DB 类型:`ComposerState`(`src/db/types.ts`)加可选字段;JSON 列无需迁移。
- IR 中间表示:`IRRequest`(`src/lib/providers/types.ts`)加可选字段(其 `[key:string]:unknown` 兜底已允许透传)。
- 前端持久化:`setConversationModelParams(convId, params)`(`src/features/chat/actions/conversations.ts`)——合并进 `composerState`;`null`/`undefined` 删键。
- 后端读取:`app/api/chat/route.ts` 的 `composerParams` 段,从 `conv.composerState` 读后覆盖 `irRequest`。
- SSR 回填:`getConversationComposerState` 返回该字段 + `app/chat/[id]/page.tsx` 的 `initialXxx` prop + `ChatComposer` 本地状态。

### 3. Contracts
- 「关闭/默认」语义用**删除键**表达,不存哨兵值:前端 off → 传 `null` → action 删键 → 后端读到 `undefined` → 不启用(等价旧行为)。
- 会话级参数**不进** `/api/chat` 请求 body,也不进 `SendOptions`——靠 `composerState` 在后端读取(与 temperature 一致)。前端只在用户改动时调 `setConversationModelParams` 写库。
- 上游专属参数走 AI SDK **请求级 `providerOptions`**,不走 provider 构造级(`createOpenAI`/`createAnthropic` 等)。因为每请求的值可能不同,且 provider 实例每次按路由/key 新建。

### 4. Validation & Error Matrix
- composerState 字段被篡改为非法值 → route 读取处用类型守卫忽略(如 `typeof x === "number"`)。
- reasoning 级别该模型不支持(`thinkingLevelMap` 显式 `null`)→ `buildReasoningProviderOptions` 返回 `undefined` → 上游请求不带该参数,**不报错**。
- 上游不认 `providerOptions` 的 namespace(如部分 openai-compatible 不认 `openai.reasoningEffort`)→ 上游忽略,**不报错**(静默降级)。
- anthropic 启用 thinking 时若 `max_tokens ≤ budget_tokens` → 必要时在翻译处抬高 max_tokens 兜底。

### 5. Good/Base/Bad Cases
- Good:模型 `capabilities.reasoning===true`,用户选 high → 上游请求携带对应 `providerOptions`,思考过程经既有 SSE `reasoning` 链路展示。
- Base:非推理模型 → 工具栏不露控件,上游请求与普通对话逐字节一致。
- Bad:某级被该模型声明为不支持 → 翻译返回 `undefined`,绝不抛错中断流。

### 6. Tests Required
- `buildReasoningProviderOptions(protocol, caps, level)`:`off`/缺省→`undefined`;openai+low→`{openai:{reasoningEffort:"low"}}`;anthropic+high→`{anthropic:{thinking:{type:"enabled",budget_tokens:N}}}`;map 显式 `null`→`undefined`;openai-compatible 无 map→`undefined`。
- 网关 `resolveReasoningLevel(effort)`:`"low"/"medium"/"high"`→原值;`"minimal"`→`"low"`;`"xhigh"`→`"high"`;`"none"`/非法→`undefined`。

### 7. Wrong vs Correct
#### Wrong
- 把 reasoning 级别塞进 `streamText` 顶层参数(AI SDK 不认)。
- 在 provider 构造级(`createOpenAI`/`createAnthropic`)配置 reasoning(reasoning 是请求级)。
- 「关闭」存哨兵字符串 `"off"` 进 composerState(应删键)。
- 新会话首次发送期望带上该参数——首次发送时尚无 conversationId,参数未落库;与 temperature 同,首次用默认,第二次起生效。
#### Correct
- 走 `streamText` 的 `providerOptions`,由 `lib/reasoning.ts` 按 `protocol`+`capabilities` 翻译。
- 前端 off → `setConversationModelParams(convId, { reasoning: null })` → 删键。

---

## Convention: per-model 能力映射(thinkingLevelMap)

**What**:模型的 `capabilities` JSON 可存 `thinkingLevelMap`(统一级别→供应商值,`null`=该级不支持);后端按 `protocol` 给默认 map,模型可覆盖。

**Why**:不同供应商的 reasoning 参数形态不同(openai=effort 字符串、anthropic/gemini=token 数),且同一 protocol 下不同模型支持的级别可能不同。per-model 映射让「统一级别」与「供应商具体值」解耦,借鉴 earendil-works/pi。

**Example**:
```ts
// lib/reasoning.ts:per-model map 优先,null=不支持;否则回退 protocol 默认
const v = capabilities?.thinkingLevelMap?.[level] ?? DEFAULT_MAP[protocol]?.[level];
```

**相关**:`src/lib/reasoning.ts`(`DEFAULT_MAP` + `buildReasoningProviderOptions` + `resolveReasoningLevel`)是推理映射的唯一中枢。
