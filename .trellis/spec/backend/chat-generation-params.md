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
- 前端持久化：`saveConversationComposerState(conversationId, snapshot): Promise<void>` 一次保存 `modelName`、`outputModeId`、`renderStyleId`、`webSearch`、`cardIds`、`kbIds` 和 `reasoningByModelId`；不得恢复字段级 Composer action，也不得新增 WebChat 普通生成参数写入。
- 内部 WebChat 请求：`POST /api/chat` 可选接收 `outputModeId?: string | null` 与 `reasoning?: ReasoningLevel`。新 Composer 显式发送点击时的解析值；旧调用可缺省。
- 后端读取：`app/api/chat/route.ts` 优先读取已校验的请求体 `reasoning`；字段缺省时按 `modelId` 回退 `composerState.reasoningByModelId`，再设置 `irRequest.reasoning`。不得从 `composerState` 覆盖 `temperature`、`top_p` 或 `max_tokens`。
- SSR 回填：`getConversationComposerState` 返回 reasoning 字段，经 `app/chat/[id]/page.tsx` 的 `initialReasoningByModelId` 初始化 `ComposerStateMachine`；运行时按具体 `modelId` 从 coordinator snapshot 解析。

### 3. Contracts
- 推理档位包含 `off`，按具体 `modelId` 保存；切换模型时恢复该模型在当前会话中的选择。
- 已有会话从 `composerState` 读取；前端通过 coordinator 的 `setModelReasoning` transition 更新完整 selection snapshot，并由 latest-only writer 串行调用完整快照 Action。
- 新会话首次发送捕获一个 selection snapshot，同时用于创建选项和本轮 `/api/chat` 请求；创建成功后以同一 snapshot adopt 真实 conversation scope。创建期间的后续变化只能作为最新完整快照补写，不能冒充创建请求已经持久化的基线。
- `/api/chat` 中 `outputModeId` 和 `reasoning` 只在字段缺省时回退会话行/`reasoningByModelId`；显式 `null` 和 `off` 必须优先，保证本轮生成不依赖异步 Composer 持久化是否完成。
- `saveConversationComposerState` 必须校验输入与当前用户属主，并用一次 `UPDATE ... WHERE id AND userId RETURNING id` 原子写独立列和完整 `composerState`，不得预读 JSON 后 merge。
- WebChat 的 `temperature`、`topP`、`maxTokens` 始终由 `prepareChatContext` 与上游模型默认策略决定；旧会话中的同名 JSON 字段必须被忽略。
- 上游专属参数走 AI SDK **请求级 `providerOptions`**,不走 provider 构造级(`createOpenAI`/`createAnthropic` 等)。因为每请求的值可能不同,且 provider 实例每次按路由/key 新建。

### 4. Validation & Error Matrix
- composerState 字段被篡改为非法值 → route 读取处用类型守卫忽略(如 `typeof x === "number"`)。
- `/api/chat` 显式 `outputModeId` 或 `reasoning` 不符合 schema → 返回 400，不回退数据库掩盖非法输入。
- `outputModeId: null` / `reasoning: "off"` → 视为显式有效值，不被 truthy/空值逻辑吞掉。
- 完整快照输入非法或 conversation 不属当前用户 → Action 抛出稳定错误且不写库。
- composerState 含历史 `temperature` / `topP` / `maxTokens` → WebChat 忽略，不覆盖 `IRRequest` 默认值。
- reasoning 级别该模型不支持时，按完整档位顺序夹到最近可用档。
- OpenAI-compatible 不复用 `openai` namespace，按模型目录 `thinkingFormat` 转换最终请求体。
- anthropic 启用 thinking 时若 `max_tokens ≤ budget_tokens` → 必要时在翻译处抬高 max_tokens 兜底。

### 5. Good/Base/Bad Cases
- Good:模型 `capabilities.reasoning===true`,用户选 high → 上游请求携带对应 `providerOptions`,思考过程经既有 SSE `reasoning` 链路展示。
- Good：用户点击发送时选择 `outputModeId: null`、`reasoning: "off"`，请求显式携带两值并优先于尚未完成的异步持久化。
- Base:非推理模型 → 工具栏不露控件,上游请求与普通对话逐字节一致。
- Base：旧 WebChat 调用缺省 snapshot 字段 → route 从会话行回退，保持兼容。
- Base:旧会话仍有历史生成参数字段 → 请求不携带这些字段，使用模型默认值。
- Bad:某级被该模型声明为不支持 → 夹到最近可用档，绝不把无效档位发送给上游。
- Bad：恢复字段级 reasoning/card/KB action 或并行 JSON 读改写，导致最后可见 Composer 状态被旧请求覆盖。

### 6. Tests Required
- 覆盖完整档位、默认选择、最近档夹取、固定推理、Anthropic budget/adaptive、Gemini budget/level 和各 compatible `thinkingFormat`。
- `conversations.test.ts` 覆盖完整快照、`null`/空数组、非法输入、非属主、单次 `UPDATE` 且无 JSON 预读。
- `/api/chat` route tests 覆盖显式 `null`/`off`、非法字段、请求体优先和字段缺省时数据库 fallback。
- Composer reducer/writer tests 覆盖 per-model reasoning、latest-only、失败/retry 和 draft create/adopt；store tests 断言新调用发送快照且旧调用保持字段缺省。
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
- 前端按 `modelId` dispatch `setModelReasoning`，由 coordinator 通过 `saveConversationComposerState` 原子保存完整快照；新会话的 create、首轮 send 与 adopt 使用同一 selection snapshot。

---

## Scenario: 模型目录同步信任边界

### 1. Scope / Trigger
- Scope:`model_catalog`、`src/lib/sync-pi-models.ts`、`scripts/sync-pi-models.ts`、`src/lib/reasoning.ts` 与 PostgreSQL 目录迁移。
- Trigger:读取 pi 模型目录、调整模型 capability/thinking 元数据，或生成目录数据迁移时，必须遵守本契约。
- Boundary:`model_catalog` 是运行时唯一事实源；pi payload 是不可信的外部 proposal，Chat、routing 和 provider adapter 不得另建模型能力白名单。

### 2. Signatures
- Planner:`planCatalogSync(rows: CatalogRow[], payload: unknown): SyncPlan`。
- SQL renderer:`buildCatalogSyncSql(plan: SyncPlan): string[]`，只接受 planner 的 `changes`。
- 匹配证据:`MatchEvidence { provider, modelKey, via, kind, authority }`，其中 `authority` 为 `direct | reference`。
- reasoning bundle:`reasoning + thinkingFormat + thinkingLevelMap + reasoningEffort`。
- CLI:`pnpm sync:pi-models` 只审计；`PI_MODELS_FILE=<snapshot> pnpm sync:pi-models -- --write` 生成下一条 migration、journal entry 和 snapshot。

### 3. Contracts
- Decoder 保留 `missing / false / true` 三态。非法 model id、compat 形状、map key、非 `string|null` value 和空字符串必须产生稳定 rejection code，不能 cast、过滤或回退后写入。
- 只有非聚合官方 provider 的精确 `provider/id`，或全目录唯一的官方裸 ID 命中，才是 `direct` proposal。aggregate、variant、path/tail fallback 和多官方来源歧义都只能进入 `references` 审计。
- `direct` 只表示结构上允许提案，不替代厂商官方资料核对。迁移中每条 accepted change 都必须有官方事实依据。
- reasoning bundle 原子更新。`reasoning=false` 且 current `reasoning===true` 时删除整个 bundle；候选 bundle 任一不变量失败时完整保留旧 bundle，vision 等独立 capability 仍可单独收敛。
- 跨 `thinkingFormat` 变更只有在外部 map 与 `supportsReasoningEffort` 三态都显式存在时才重建整个 bundle；缺任一字段即拒绝并保留旧包。同一 format 的缺失字段才允许按 current 保留。
- current 未启用 reasoning 时，孤立 `thinkingFormat`/map/effort 不自动清理；记录 `reasoning_disabled_extras_ignored` 并保留现状，避免把缺少明确能力迁移的元数据差异升级为写操作。
- `fixed` 必须是 `off:null` 且恰好一个非 `off` 档位映射到非空字符串。运行时只显示该唯一档位，compatible/provider request 不伪造控制参数；同步不得用 pi toggle map 覆盖 curated fixed bundle。
- planner 对行、对象 key、change、reference、rejection 和 unmatched 输出做稳定排序。dry-run、审计与 SQL 共享这一份 plan，CLI 不得重新 match、translate 或 fallback。
- `--write` 只接受显式本地 snapshot，并在 SQL 中记录 SHA-256；禁止 `--apply`、bulk import、隐式 cache fallback 和 live-source write。失败输出只含稳定 stage/reason，不含 URL、路径、payload、credential、cause 或 stack。
- 数据修复只追加 forward migration。SQL 使用定向 JSONB delete/patch 与 `IS DISTINCT FROM`，保留无关字段且仅在真实变化时刷新 `updated_at`；SQL、journal、snapshot 必须一起生成和提交。
- reasoning 降级的 operation 必须规范化为四个 bundle key 的 delete，即使旧行缺少其中部分 key；这样生成的 migration 对前序允许范围内的稀疏数据仍能收敛到同一结果。

### 4. Validation & Error Matrix
| Condition | Planner / CLI result | Runtime / Data result |
| --- | --- | --- |
| 外部 map 含未知 key、空串或非法 value | rejection；reasoning bundle 不变 | 继续消费原 catalog |
| 跨 format proposal 缺 map 或 effort 三态 | `invalid_reasoning_bundle` | 旧 reasoning bundle 原样保留 |
| direct `reasoning=false`，current reasoning=true | accepted bundle delete | Chat 隐藏档位，stale model state 收敛到 `off`，请求不发送 thinking |
| reasoning=false 但携带 thinking extras | extras 记审计；若 current 未启用 reasoning 则无 change | 孤立 current 元数据原样保留 |
| aggregate/tail/path/歧义匹配 | reference only | catalog 不变 |
| fixed 不是 `off:null + 唯一开启档` | `invalid_reasoning_bundle` | malformed fixed 防御性隐藏控件 |
| `--write` 未提供本地 snapshot | `write_requires_snapshot` | 不产生任何迁移产物 |
| migration 重复执行 | `IS DISTINCT FROM` 不命中 | capability 与 `updated_at` 均不变 |

### 5. Good / Base / Bad Cases
- Good:官方确认模型不再支持 reasoning，planner 生成整包删除；迁移保留 tools/systemPrompt 等无关 key，消费者自动隐藏档位。
- Good:Kimi K2.7 的 curated fixed bundle 遇到 pi toggle 元数据时保持不变。
- Base:generic、未匹配和 reference 模型只出现在审计报告，目录数据不变。
- Bad:脚本读取 pi 后自行构造 upsert，导致 dry-run 与 SQL 使用两套 match/fallback 逻辑。
- Bad:看到 reasoning=false + thinkingFormat 就清理一个从未启用 reasoning 的 catalog 行；这缺少明确的能力迁移证据。

### 6. Tests Required
- `sync-pi-models.test.ts`:覆盖三态 decoder、非法 map/compat、direct/reference/歧义、双向 capability 变更、reasoning 原子回退、孤立 thinking 审计、fixed 不变量、确定性 plan 和 SQL operation。
- `sync-pi-models-cli.test.ts`:覆盖参数分隔符、旧 flag 拒绝、snapshot-only write、固定脱敏错误和审计脱敏。
- `reasoning.test.ts`:覆盖 levels/default/clamp/modelId stale state，以及 reasoning 降级后 compatible/provider 请求不发送 thinking。
- `model-catalog.test.ts`:断言 migration 目标与精确 JSONB 表达式、source digest、journal idx/time 和 snapshot prevId/schema。
- 隔离 PostgreSQL:先应用前序迁移，再应用最新 migration 两次；断言行数、外键、无关 capability 与第二次 `updated_at` 不变，最后删除随机测试库。

### 7. Wrong vs Correct
#### Wrong
```typescript
const next = translate(current, match(pi));
await db.execute(buildUpsert(next));
```

#### Correct
```typescript
const plan = planCatalogSync(rows, payload);
const statements = buildCatalogSyncSql(plan);
// 人工核对 accepted changes 与官方资料后，写入 forward migration。
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
- pi API 与 `docs/cankao/pi/packages/ai` 只用于发现模型、兼容格式和待审 proposal；它们不能单独授权目录写入。
- 新增或修正模型时，**必须查厂商官方文档原文**(`platform.stepfun.com`、`api.xiaomimimo.com` 等),不看阿里云 Model Studio、OpenRouter 转发、HF 讨论等二手/中转描述。
- 同一模型经不同上游接入,参数语义不同:`enable_thinking` / `reasoning_effort` / `reasoning.effort` 分别对应 DashScope 直连 / OpenAI 系 / OpenRouter。`thinkingFormat` 跟随该模型实际路由的 `protocol` + `base_url`,不按 alias 前缀猜。
- 推理模型若本质上无法关闭思考(默认总思考),用 `thinkingLevelMap:{off:null,...}` 反映,不向用户暴露假的「关闭」选项;档位按官方实际支持的强度(low/medium/high 等)配置。

**Why**:曾据阿里云 Model Studio 中转层把 step-3.7 配成 `qwen`(发 `enable_thinking`),但 StepFun 官方 `api.stepfun.com` 用 `reasoning_effort`,不认 `enable_thinking`,导致「选关仍思考」。中转层常额外封装参数,与官方原生 API 不一致。

**Wrong**:据 WebSearch 二手结果或中转平台文档配 `thinkingFormat`;按 alias 前缀(`qwen/`、`xiaomi/`)猜接入协议。
**Correct**:先用 pi 定位兼容语义，再由厂商官方文档确认参数名、取值、输入能力和是否可关闭；只有两者通过 planner 与人工门禁后才写 migration。

**相关**:`AGENTS.md`「模型目录维护」;`src/lib/reasoning.ts` 各 `thinkingFormat` 分支。

---

## Scenario: Background Conversation Title Request Boundary

### 1. Scope / Trigger
- Scope: Background title jobs that call `generateChat` from `lib/conversation-title/service.ts`.
- Trigger: Changes to the title prompt, generation parameters, or title model must keep instructions separate from the original user text.

### 2. Signatures
- `IRRequest.messages` contains one `system` title instruction and one `user` message with at most the first 500 characters of the original text.
- Title jobs send `temperature:0` and `max_tokens:64` without conversation history or memory.

### 3. Contracts
- The `system` instruction must require a title based only on the original text. If the text has no clear meaning to summarize, return it unchanged without additions, associations, or guesses.
- The original user text must be sent only as a separate `user` message and must not be appended to the instruction message.
- Model output still passes through `sanitizeTitle`; empty output is a generation failure and preserves the fallback.

### 4. Validation & Error Matrix
- Blank first message -> do not create a title job.
- Low-information input such as digits or symbols only -> return the input unchanged without inventing meaning.
- Model error, empty text, or empty sanitized output -> fail the task and preserve the durable job for retry.

### 5. Good / Base / Bad Cases
- Good: `888` -> `888`.
- Base: A meaningful question -> generate a related title of at most 30 characters.
- Bad: Concatenate the instruction and original text in one `user` message, allowing the model to invent meaning for low-information input.

### 6. Tests Required
- `conversation-title/service.test.ts` asserts message-role order, exact instruction/original-text separation, `temperature:0`, `max_tokens:64`, and the configured model ID.
- When changing the title prompt or model adapter, run one real-model smoke test with the same complete request and a low-information input.

### 7. Wrong vs Correct
#### Wrong
```typescript
messages: [{ role: "user", content: instruction + rawUserMessage }]
```

#### Correct
```typescript
messages: [
  { role: "system", content: instruction },
  { role: "user", content: rawUserMessage },
]
```
