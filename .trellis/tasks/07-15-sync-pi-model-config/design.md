# Design — 同步 pi 模型配置

## 1. 数据流

```
docs/cankao/pi/.../models.generated.ts          scripts/sync-pi-models.ts
   MODELS = { provider: { id: Model<Api> } }  ──►  匹配 + 字段翻译
                                                        │
drizzle/pg/0000_baseline.sql (现有 catalog)  ─────────┤  读取「现有 chat 条目清单」
                                                        ▼
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                              差异报告(stdout/文件)        drizzle/pg/0001_sync_pi_models.sql
                              (旧值→新值 / 未匹配)          + meta/_journal.json(idx=1)
```

## 2. pi 数据源

- 入口:`docs/cankao/pi/packages/ai/src/models.generated.ts`,导出 `MODELS: { [provider]: { [modelId]: Model<Api> } }`,聚合全部 35 个 provider。
- 读取方式:脚本用 `tsx` 直接 `import { MODELS }`。pi 文件用 `satisfies Model<...>` 与 `.ts` 扩展名 import,需 TS 5 + tsx(项目已具备)。
- **风险/fallback**:pi 的 import 链含 `bedrock-provider` 等。若整包 import 失败,fallback 为「按白名单 import 单个 provider 的 `*.models.ts`」(zai/moonshotai/deepseek/openai/anthropic/google/xai 等我们实际用的)。实现时先验证整包 import。

## 3. 匹配算法

对现有 catalog 每个 `model_type='chat'` 条目,在 pi `MODELS` 中查找:

1. 遍历该 catalog 条目的 `aliases[]`(形如 `"zai/glm-5.2"`)+ `canonicalModelId`。
2. 对每个候选串:
   - 含 `/`:拆成 `[provider, id]`,查 `MODELS[provider]?.[id]` —— **精确匹配,优先**。
   - 不含 `/`:在全 provider 里按裸 `id` 扫描,命中则记录(可能多命中)。
3. 命中规则:精确 `provider/id` 命中取之;否则裸 `id` 唯一命中取之;多命中/零命中进「未匹配」报告,该条目**不动**。

举例:`glm-5.2` aliases 含 `zai/glm-5.2` → `MODELS.zai["glm-5.2"]` 命中。

## 4. 字段映射(pi `Model<Api>` → 我们 `model_catalog`)

| 我们字段 | pi 来源 | 规则 |
|---|---|---|
| `capabilities.thinkingLevelMap` | `thinkingLevelMap` | 见 §5b 不变量闸门 |
| `capabilities.reasoningEffort` | `compat.supportsReasoningEffort` | 布尔直传 |
| `capabilities.reasoning` | `reasoning` | 布尔直传 |
| `capabilities.vision` | `input.includes("image")` | `true`/缺省 |
| `context_window` | `contextWindow` | 数字直传 |
| `max_output_tokens` | `maxTokens` | 数字直传 |
| `capabilities.thinkingFormat` | `compat.thinkingFormat` | 见 §5 |
| `name/aliases/model_type/enabled/sort_order/tools/systemPrompt/imageGeneration/...` | — | 不动 |

合成的目标 `capabilities` 仅含:被 pi 明确提供的键 + 保留的 `thinkingFormat` + 原有 `tools/systemPrompt/...`(从现有值拷贝,不被 pi 覆盖)。

## 5. thinkingFormat 策略(按不变量优先)

**总则**:`thinkingFormat` 仅当属 KEEP(`fixed`/`agnes`/`anthropic-adaptive`)或 pi 给了 OVERLAP 重叠格式时保留;否则一律去标识 → 无 `thinkingFormat`。涵盖 claude(非 adaptive)/gemini/openai 原生,及 MiniMax 等走 anthropic 协议的模型(均零行为变化)。

- claude(非 adaptive)/gemini:**去掉**现有 `anthropic`/`google` 标识 → 无 `thinkingFormat`。这些标识对请求无实质作用(`applyReasoningToCompatibleBody` 只在 openai-compatible 协议调用;`buildReasoningProviderOptions` 按 `protocol` 分支、不读 `thinkingFormat`),去掉零行为变化,且贴近 pi。
- `anthropic-adaptive`:**保留**(reasoning.ts:168 让 claude 走 adaptive thinking,有实质作用)。
- `fixed`/`agnes`:**保留**(pi 无对应)。
- pi 9 个重叠格式(`openai/openrouter/deepseek/together/zai/qwen-chat-template/string-thinking/ant-ling`):采用 pi 值。

## 5b. 不变量闸门(刷 `thinkingLevelMap` 前置检查)

对每个候选改动,先用我们的 `getSupportedReasoningLevels(目标 capabilities)` 算 `levels`,断言满足 prd 三条不变量;不满足则**跳过该字段**(保现状)并记报告。已知:

- `kimi-k2.5`/`kimi-k2.6`:pi 无 `thinkingLevelMap` → 会让 `levels=[off,minimal,low,medium,high]`(deepseek 开关型、`reasoningEffort` 未设,5 档全假,违反不变量1)→ **闸门拦截**,仅把 `high` 的 `""` 规范化为 `"high"`(`levels` 保持 `[off,high]`,不变量2)。
- `glm-5.2`:`low/medium→"high"` 后 `levels=[off,low,medium,high,max]`,选不同档发不同 `reasoning_effort`,符合不变量1 → 通过。

## 6. 脚本结构(`scripts/sync-pi-models.ts`)

```
- loadCatalogChatModels():  连 DB 读 model_catalog 的 chat 条目现状(getDb + select;读运行态最准)。
                             产物为全量 upsert、对新库重放也达目标态,故读运行库不影响迁移通用性。重跑需 DATABASE_URL。
- loadPiModels():           import { MODELS } from pi
- match(catEntry, MODELS):  §3 算法 → pi Model | null
- translate(piModel, curCap): §4/§5 → 目标 capabilities + context/maxOut
- assertInvariants(target): 复用 getSupportedReasoningLevels 断言三条不变量;违反字段回退现状并标记
- diff(cur, target):        逐字段旧值→新值
- emit():                   打印差异报告 + 写 0001_sync_pi_models.sql
```

输出 SQL 形态(幂等):
```sql
INSERT INTO "model_catalog" ("id","canonical_model_id","capabilities","context_window","max_output_tokens")
VALUES (gen_random_uuid(),'glm-5.2', '{...}'::jsonb, 1000000, 131072)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = EXCLUDED."capabilities",
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
```
注:`capabilities` 为**全量覆盖**(目标对象),确保移除键(如 kimi 的 thinkingLevelMap)生效。

## 7. 迁移落地(drizzle)

- 新增 `drizzle/pg/0001_sync_pi_models.sql`(脚本生成的内容)。
- `meta/_journal.json` 追加 `{ idx:1, version:"7", when:<ts>, tag:"0001_sync_pi_models", breakpoints:true }`。
- schema 无变更:`meta/0001_snapshot.json` 复制 `0000_snapshot.json`(drizzle migrate 按 journal 执行 sql,snapshot 仅 generate diff 用,数据迁移不触发 generate)。
- `when` 时间戳:脚本生成时由外部传入(避免脚本内取时)。

## 8. 测试

- 单测 `match()`:`glm-5.2`/`kimi-k2.5`/`claude-*`/未匹配 用例。
- 单测 `translate()`:`glm-5.2` low/medium→high;`kimi-k2.5` high `""`→`"high"`(不移除 map);claude 非 adaptive 去标识、adaptive 保留。
- 单测 `assertInvariants()`:kimi 贴 pi「无 map」被闸门拦截;glm 通过。
- 快照:`0001_sync_pi_models.sql` 内容快照,pi 数据更新后重跑对比。
- 迁移幂等:在事务里跑两遍,断言 catalog 状态一致。

## 9. 回滚

- 数据迁移可逆:保留 `0001` 之前的 capabilities 快照(脚本生成的报告即旧值清单),回滚 = 按报告反向 UPDATE 或 `drizzle-kit rollback`(若配置)。
- 因不改 schema,回滚纯数据,无结构风险。
