# Chat 推理控制与默认生成参数

> WebChat 只提供按模型保存的 reasoning/thinking 档位；temperature/topP/maxTokens 不提供会话级配置，聊天请求使用上下文准备阶段与上游模型的默认策略。网关公共 IR 类型仍可承载标准生成参数。

---

## Scenario: WebChat 推理档位与默认生成参数

### 1. Scope / Trigger
- Scope: `src/app/api/chat/route.ts`、`ChatComposer` 与会话 composer state 的站内聊天链路。
- Trigger: 新增或调整按模型保存的 reasoning 档位，或重新引入 WebChat 级生成参数时，必须同步本契约。
- Boundary: WebChat 不读取、不持久化、不发送 `temperature`、`topP`、`maxTokens` 的用户配置；`IRRequest` 的标准字段和其他网关调用不因本次约束删除。

### 2. Signatures
- 会话 JSON:`composerState.reasoningByModelId?: Record<string, ReasoningLevel>`；历史 JSON 中遗留的 `temperature` / `topP` / `maxTokens` 允许保留，但不得被 WebChat 读取。
- IR 中间表示:`IRRequest`(`src/lib/providers/types.ts`)加可选字段(其 `[key:string]:unknown` 兜底已允许透传)。
- 前端持久化:推理档位走 `setConversationModelReasoning(convId, modelId, level)`，写入 `reasoningByModelId`；不得新增 WebChat 的普通参数写入 action。
- 后端读取:`app/api/chat/route.ts` 只读取 `reasoningByModelId` 并设置 `irRequest.reasoning`；不得从 `composerState` 覆盖 `temperature`、`top_p` 或 `max_tokens`。
- SSR 回填:`getConversationComposerState` 返回 reasoning 字段 + `app/chat/[id]/page.tsx` 的 `initialReasoningByModelId` prop + `ChatComposer` 本地状态。

### 3. Contracts
- 推理档位包含 `off`，按具体 `modelId` 保存；切换模型时恢复该模型在当前会话中的选择。
- 已有会话从 `composerState` 读取；新会话首次发送时通过创建选项把当前 `modelId + level` 一并写入，保证首轮生效。
- WebChat 的 `temperature`、`topP`、`maxTokens` 始终由 `prepareChatContext` 与上游模型默认策略决定；旧会话中的同名 JSON 字段必须被忽略。
- 上游专属参数走 AI SDK **请求级 `providerOptions`**,不走 provider 构造级(`createOpenAI`/`createAnthropic` 等)。因为每请求的值可能不同,且 provider 实例每次按路由/key 新建。

### 4. Validation & Error Matrix
- composerState 字段被篡改为非法值 → route 读取处用类型守卫忽略(如 `typeof x === "number"`)。
- composerState 含历史 `temperature` / `topP` / `maxTokens` → WebChat 忽略，不覆盖 `IRRequest` 默认值。
- reasoning 级别该模型不支持时，按完整档位顺序夹到最近可用档。
- OpenAI-compatible 不复用 `openai` namespace，按模型目录 `thinkingFormat` 转换最终请求体。
- anthropic 启用 thinking 时若 `max_tokens ≤ budget_tokens` → 必要时在翻译处抬高 max_tokens 兜底。

### 5. Good/Base/Bad Cases
- Good:模型 `capabilities.reasoning===true`,用户选 high → 上游请求携带对应 `providerOptions`,思考过程经既有 SSE `reasoning` 链路展示。
- Base:非推理模型 → 工具栏不露控件,上游请求与普通对话逐字节一致。
- Base:旧会话仍有历史生成参数字段 → 请求不携带这些字段，使用模型默认值。
- Bad:某级被该模型声明为不支持 → 夹到最近可用档，绝不把无效档位发送给上游。

### 6. Tests Required
- 覆盖完整档位、默认选择、最近档夹取、固定推理、Anthropic budget/adaptive、Gemini budget/level 和各 compatible `thinkingFormat`。
- 覆盖含历史生成参数字段的会话，断言 `/api/chat` 不把它们写入 `IRRequest`。
- 网关 `resolveReasoningLevel` 保留 `minimal/low/medium/high/xhigh/max`，`none` 映射为 `off`。

### 7. Wrong vs Correct
#### Wrong
- 在 ChatToolbar 恢复 `ModelParamsPicker`，或在 `/api/chat` 从 `composerState` 读取并覆盖 `irRequest.temperature` / `top_p` / `max_tokens`。
- 把 reasoning 级别塞进 `streamText` 顶层参数(AI SDK 不认)。
- 在 provider 构造级(`createOpenAI`/`createAnthropic`)配置 reasoning(reasoning 是请求级)。
- 把推理档位保存成会话全局单值，导致切换模型后串档。
#### Correct
- WebChat 只持久化 `reasoningByModelId`；历史普通生成参数字段保留也不读取，默认值由上下文准备和上游模型决定。
- 走 `streamText` 的 `providerOptions`,由 `lib/reasoning.ts` 按 `protocol`+`capabilities` 翻译。
- 前端按 `modelId` 调用 `setConversationModelReasoning`；新会话创建时同时写入首个模型档位。

---

## Scenario: fixed 推理目录与 pi 同步

### 1. Scope / Trigger
- Scope: `model_catalog.capabilities`、`src/lib/reasoning.ts`、`src/lib/sync-pi-models.ts` 与目录数据迁移。
- Trigger: 新增或调整 `thinkingFormat: "fixed"` 模型、同步 pi 模型元数据，或修复 fixed 存量目录时，必须遵守本契约。
- Boundary: `fixed` 只描述模型官方请求语义；不得据 Provider URL 改写，也不得在 Chat 或路由层另写能力判断。

### 2. Signatures
- 目录形状:`ModelCapabilities { reasoning: true, thinkingFormat: "fixed", thinkingLevelMap }`。
- 运行时:`getSupportedReasoningLevels(capabilities): ReasoningLevel[]`。
- 同步:`resolveThinkingLevelMap(current, pi): ThinkingLevelMap | undefined` 与 `passesInvariants(capabilities): boolean`。
- 数据修复:追加 PostgreSQL 迁移，以 `capabilities || patch::jsonb` 按 `canonical_model_id` 定向更新。

### 3. Contracts
- fixed map 必须恰好有一个显式非空字符串值的非 `off` 档位；`off` 必须为 `null`，表示不可关闭。
- fixed 的缺省键不继承普通格式的 `off/minimal/low/medium/high` 默认支持语义。运行时只返回 map 中显式非空字符串值的非 `off` 档位，不自动猜测 `high`。
- 合法 fixed 的默认值和失效会话值均夹到唯一档位；`buildReasoningProviderOptions` 返回 `undefined`，compatible 请求体保持原样，不伪造启停或强度参数。
- 当前目录已经声明 fixed 时，pi 同步必须同时保留 curated `thinkingFormat` 与 `thinkingLevelMap`；不得采用 pi 的 toggle map。保留现有空字符串规范化规则。
- `passesInvariants` 对 fixed 要求支持档位数量严格等于 1；其他 reasoning 模型仍要求至少一个可用档位。
- 已发布目录迁移不得改写。存量修复必须追加迁移并同步 journal/snapshot，JSONB 顶层合并只能替换推理键，保留其他 capabilities。

### 4. Validation & Error Matrix
| Condition | Runtime | Sync / Migration |
| --- | --- | --- |
| 合法 fixed，唯一开启档 | 返回唯一档，默认与失效值夹到该档 | 不变量通过 |
| fixed 只有 `{off:null}` | 返回空数组，不显示假档位 | 不变量失败，禁止作为合法同步结果 |
| fixed 有多个开启档 | 返回显式档位，不猜测所有权 | 不变量失败，禁止落盘 |
| current fixed + pi `deepseek` toggle map | 继续使用 current curated map | 不产生 capabilities 覆盖差异 |
| 存量 fixed 数据损坏 | 防御性隐藏无效控件 | 追加定向迁移修复，不覆盖其他 capability |

### 5. Good / Base / Bad Cases
- Good:Kimi K2.7 使用 `off:null + high:"default"`，Chat 显示固定开启，请求体不增加控制字段。
- Base:非 fixed 模型继续按目录 map 与格式默认值生成可用档位，既有翻译行为不变。
- Bad:保留 current `fixed` 格式，却用 pi 的 `{off:null}` 覆盖 map，形成格式与档位所有权不一致的混合配置。
- Bad:在运行时为 malformed fixed 自动补 `high`；这会掩盖目录损坏并绕过同步闸门。

### 6. Tests Required
- `reasoning.test.ts`:覆盖 `{off:null}` 与空字符串返回空数组、合法 fixed 唯一档、默认/夹取与请求体原样。
- `sync-pi-models.test.ts`:覆盖 current fixed 遇 pi toggle map 时保留、fixed 零/一/多档不变量。
- `model-catalog.test.ts`:读取追加迁移，断言目标 canonical ID、完整 fixed map、JSONB 合并与 `updated_at`。
- 迁移元数据:断言新 snapshot 的 `prevId` 指向上一 snapshot，且 custom 数据迁移不引入 schema 差异。

### 7. Wrong vs Correct
#### Wrong
```typescript
if (pi.thinkingLevelMap) return pi.thinkingLevelMap;
```

#### Correct
```typescript
if (current.thinkingFormat === "fixed") return normalize(current.thinkingLevelMap);
if (pi.thinkingLevelMap) return pi.thinkingLevelMap;
```

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

---

## Convention: thinkingFormat 对齐厂商官方文档原文

新增/修正模型 `thinkingFormat` 与 `reasoningEffort` 时,参数名与取值必须以**厂商官方 API 文档原文**为准,不得依赖中转层或聚合层文档。

**What**:
- 首选 `docs/cankao/pi`(`packages/ai/src/providers/*.models.ts`)对齐:`thinkingFormat`、`supportsReasoningEffort`、`thinkingLevelMap` 均有现成权威值。
- pi 未收录的模型(如 StepFun step-3.7),**必须查厂商官方文档原文**(`platform.stepfun.com`、`api.xiaomimimo.com` 等),不看阿里云 Model Studio、OpenRouter 转发、HF 讨论等二手/中转描述。
- 同一模型经不同上游接入,参数语义不同:`enable_thinking` / `reasoning_effort` / `reasoning.effort` 分别对应 DashScope 直连 / OpenAI 系 / OpenRouter。`thinkingFormat` 跟随该模型实际路由的 `protocol` + `base_url`,不按 alias 前缀猜。
- 推理模型若本质上无法关闭思考(默认总思考),用 `thinkingLevelMap:{off:null,...}` 反映,不向用户暴露假的「关闭」选项;档位按官方实际支持的强度(low/medium/high 等)配置。

**Why**:曾据阿里云 Model Studio 中转层把 step-3.7 配成 `qwen`(发 `enable_thinking`),但 StepFun 官方 `api.stepfun.com` 用 `reasoning_effort`,不认 `enable_thinking`,导致「选关仍思考」。中转层常额外封装参数,与官方原生 API 不一致。

**Wrong**:据 WebSearch 二手结果或中转平台文档配 `thinkingFormat`;按 alias 前缀(`qwen/`、`xiaomi/`)猜接入协议。
**Correct**:先查 pi;pi 没有则查厂商官方文档原文,确认参数名 + 取值 + 是否可关闭。

**相关**:`AGENTS.md`「模型目录维护」;`src/lib/reasoning.ts` 各 `thinkingFormat` 分支。
