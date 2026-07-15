# 同步 pi 模型配置到 model_catalog

## Goal

把现有 `model_catalog` 里主流 chat 模型的**配置值**对齐到 pi(`docs/cankao/pi`)的模型目录,消除历史残留造成的「档位/上下文窗口/能力位」与 pi 不一致;产物为可重跑的对齐脚本 + 一条 drizzle 数据迁移。

## Background

- 我们的 catalog 用扁平 `ModelCapabilities`(`vision/tools/reasoning/systemPrompt/reasoningEffort/thinkingFormat/thinkingLevelMap/...`),`thinkingFormat` 枚举 14 个(含 `fixed/anthropic/anthropic-adaptive/google/agnes` 等原生协议标识)。
- pi 用 `Model<Api>` + `compat` 子对象 + `input[]`,`thinkingFormat` 枚举 10 个(仅 OpenAI-compatible 改写格式),原生 API(anthropic/google)模型不设 `thinkingFormat`。
- 两套**字段形态不同,无法字段级照搬**;「对齐」= 把可对应的**具体值**刷成与 pi 一致(`thinkingLevelMap` 各档位值、`reasoningEffort`、`contextWindow`、`maxOutputTokens`、`vision`)。
- 现状已半对齐,但存在残留差异(例:`glm-5.2` 的 `low/medium` 我们为 `null`、pi 为 `"high"`;`kimi-k2.5/k2.6` 被历史 UPDATE 设成可疑的 `high:""`,pi 中该模型**无** `thinkingLevelMap`)。

## Requirements

1. **对齐范围**:仅 `modelType='chat'` 且能匹配上 pi 目录的现有 catalog 条目。非 chat 模型(image/embedding/rerank/audio)、匹配不上的模型一律不动并在报告中列出。
2. **对齐字段**(形态可对应者,均受 §Constraints 不变量约束):
   - `capabilities.thinkingLevelMap` ← pi `thinkingLevelMap`;**仅当刷后 `levels` 仍满足三条不变量才刷,否则保现状**。
   - `capabilities.reasoningEffort` ← pi `compat.supportsReasoningEffort`
   - `capabilities.vision` ← pi `input` 含 `"image"` 为 `true`
   - `capabilities.reasoning` ← pi `reasoning`
   - `context_window` ← pi `contextWindow`
   - `max_output_tokens` ← pi `maxTokens`
3. **thinkingFormat 策略**(按不变量优先):
   - claude(非 adaptive)/gemini:**去掉**现有 `anthropic`/`google` 标识 → 无 `thinkingFormat`(行为零变化,仅清理展示标签)。
   - claude 的 `anthropic-adaptive`(fable-5/opus-4.6~4.8/sonnet-4.6/5 等):**保留**,有实质作用(reasoning.ts:168 adaptive 分支)。
   - `fixed`(grok-reasoning/grok-4.3/4.5/build/kimi-k2.7-code/-highspeed/composer-2.5)/`agnes`:**保留不动**(pi 无对应)。
   - pi 9 个重叠格式(`openai/openrouter/deepseek/together/zai/qwen-chat-template/string-thinking/ant-ling`):采用 pi 值。
4. **特殊模型处理(不变量优先于贴 pi)**:
   - `kimi-k2.5`/`kimi-k2.6`:**不贴 pi**(pi 无 `thinkingLevelMap` 会让 `levels` 变 5 档全是假档,违反不变量1)。仅把 `thinkingLevelMap.high` 的 `""` 残留**规范化为 `"high"`**,`levels` 保持 `[off,high]` 单一档(不变量2),行为零变化(`reasoningEffort` 未设,deepseek 不发 effort)。
   - `glm-5.2` 等「凑数档」:**跟 pi**(`low/medium→"high"`)。刷后 `levels=[off,low,medium,high,max]`,选不同档发不同 `reasoning_effort` 值,属"可调"(符合不变量1)。
5. **不动字段**:`name`/`aliases`/`model_type`/`enabled`/`sort_order`/`tools`/`systemPrompt`/多模态生成位(`imageGeneration` 等)。pi 无可靠对应,保留人工配置。
6. **产物**:
   - 对齐脚本 `scripts/sync-pi-models.ts`:读 pi `models.generated.ts` → 匹配 catalog → 输出差异报告 + 生成 SQL。
   - drizzle 数据迁移 `drizzle/pg/0001_sync_pi_models.sql` + `_journal.json` 新增 entry;schema 不变,snapshot 沿用 0000。
7. **幂等**:迁移用 `ON CONFLICT(canonical_model_id) DO UPDATE`,脚本可重复运行产出稳定结果。
8. **不在本任务范围**(future work):管理后台「点添加 → 查询 pi → 入库」的交互式按需拉取。

## Constraints

- **Chat 推理强度显示三不变量(最高优先级,优先于「贴 pi」)**:
  1. 不显示推理强度 ⇒ 模型不能开推理(`reasoning !== true`)。
  2. 显示但只有一种强度 ⇒ 显示为「开且不可调」(`reasoning=true` 且 `levels` 恰好 1 个非 off 档)。
  3. 显示推理强度 ⇒ 必可调,且只显示模型真实拥有的强度档。
  - 由 `ReasoningPicker`(ChatToolbar.tsx:445)+ `getSupportedReasoningLevels`(reasoning.ts:18)实现;脚本刷配置后必须对每个被改模型断言 `levels` 仍满足,违反则**跳过该字段**并记入报告。
- 不改任何 schema 结构、不改前端/路由层能力判断逻辑、不改 `reasoning.ts`。
- 遵守 `CLAUDE.md`:目录数据变更须提供 PostgreSQL 迁移 + 同步 Drizzle journal/snapshot,补模型匹配与字段翻译测试。
- `docs/cankao/pi` 为只读参考,不修改。
- 不在注释/日志/commit 暴露敏感信息。

## Acceptance Criteria

- [ ] `scripts/sync-pi-models.ts` 能 import pi `MODELS` 并按 `canonicalModelId`/`aliases` 匹配现有 catalog chat 模型。
- [ ] 产出差异报告:逐模型列出改动字段 `旧值 → 新值`,并列出「未匹配」「非 chat 已跳过」清单。
- [ ] 生成 `drizzle/pg/0001_sync_pi_models.sql`(幂等 upsert)并正确更新 `_journal.json`(idx=1)。
- [ ] **不变量不破坏**:刷后每个被改模型的 `getSupportedReasoningLevels` 仍满足三条不变量;脚本内置断言,违反则跳过该字段并记入报告。
- [ ] `glm-5.2`:`thinkingLevelMap.low/medium`→`"high"`(跟 pi),`context_window`→1000000,`max_output_tokens`→131072。
- [ ] `kimi-k2.5`/`kimi-k2.6`:`thinkingLevelMap.high` `""`→`"high"`(保留 `[off,high]` 单一档,不贴 pi 无 map)。
- [ ] claude(非 adaptive)/gemini:去掉 `anthropic`/`google` 标识 → 无 `thinkingFormat`;`anthropic-adaptive` 保留。
- [ ] 模型匹配 + 字段映射 + 不变量断言的单测/快照测试通过。
- [ ] 迁移在干净库上重放无报错、幂等。
