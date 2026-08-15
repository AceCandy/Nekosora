# 自动同步主流模型：技术设计

## 1. 边界与数据流

```text
pi snapshot (unknown)
  -> decodePiModelsApi（唯一外部校验边界）
  -> mainstream model policy（官方 Provider + 家族 + 排除规则）
  -> planCatalogSync（同一计划同时拥有 additions / changes / references / rejections）
  -> renderSyncPlan（dry-run 审计）
  -> buildCatalogSyncSql（INSERT + 既有 UPDATE）
  -> writeMigration（source digest + journal + snapshot）
```

CLI 不做第二套识别、能力翻译或 SQL 拼装。dry-run 与 `--write` 必须消费同一份 `SyncPlan`。

## 2. 主流模型策略

在 `packages/core/src/lib/` 新增一个独立策略模块，导出单一表驱动配置和纯判定函数。每个家族只描述：

- 业务家族名；
- 官方主 Provider；
- 大小写不敏感的模型 ID 前缀。

首批映射：

| 家族 | 官方 Provider | ID 前缀 |
| --- | --- | --- |
| GPT | `openai` | `gpt-` |
| Claude | `anthropic` | `claude-` |
| Gemini | `google` | `gemini-` |
| GLM | `zai` | `glm-` |
| MiniMax | `minimax` | `minimax-` |
| Kimi | `moonshotai` | `kimi-` |
| MiMo | `xiaomi` | `mimo-` |
| Grok | `xai` | `grok-` |
| Qwen | `qwen-token-plan` | `qwen` |
| DeepSeek | `deepseek` | `deepseek-` |

`openai-codex`、地区后缀 Provider、聚合商不作为新增事实源。`qwen-token-plan` 虽包含其他厂商条目，但前缀闸门只允许 Qwen。

`preview` 不排除。统一排除 ID 中的 `batch`、`live`、`image`、`customtools`、`computer-use`、`robotics`、`realtime`，以及日期快照和 `*-latest` 别名。判定只决定是否为新增候选，不进入 Chat、routing 或 Provider adapter，运行时仍只读 `model_catalog`。

## 3. Planner 合约

扩展 `SyncPlan`，新增稳定排序的 `additions`。每个 addition 保存：

- `canonicalModelId = pi.id`；
- `name = pi.name`，缺失或空白时拒绝新增；
- 官方 source evidence（provider/modelKey）；
- `modelType = chat` 的目录数据；
- capabilities、contextWindow、maxOutputTokens。

现有行仍先走原 match/update 流程，并记录已被 catalog 行占用的 source key。新增候选只来自策略允许且未被任何现有 canonical/alias 匹配的官方 source；相同 canonical ID 在计划内去重。已有 canonical ID 永不同时出现在 addition 与 change。

审计输出新增 `new` 行和 `additions=<n>` 汇总；既有 accepted update、reference、rejection、unmatched 语义保持。

## 4. 新模型能力构造

能力构造位于 planner 纯逻辑中，CLI 不补默认值：

- 固定业务默认：`tools=true`、`systemPrompt=true`；
- `input` 含 `image` 时才设 `vision=true`；
- context/max output 仅采用已解码的正整数；
- `reasoning=false` 时不写 reasoning bundle；
- `reasoning=true` 时必须没有 reasoning decode issue，且 pi 提供合法 `thinkingLevelMap`；否则新增模型但省略整个 reasoning bundle，并记录稳定 rejection；
- 合法的 `compat.thinkingFormat`、`supportsReasoningEffort` 继续遵守现有格式兼容闸门；`compat.forceAdaptiveThinking=true` 在 decoder 边界翻译为目录语义 `anthropic-adaptive`；
- 构造完成后复用 `validReasoningBundle` / `passesInvariants`，失败时原子舍弃整个 reasoning bundle，不保留孤立字段。

这样可以收录模型本身，同时不因不完整 pi 元数据伪造推理档位。后续人工确认可通过 forward migration补齐能力。

## 5. SQL 与迁移

`buildCatalogSyncSql` 同时渲染：

1. 按 canonical ID 排序的 addition `INSERT`；
2. 既有按 canonical ID 排序的 UPDATE。

INSERT 显式写入 `canonical_model_id`、`name`、`model_type='chat'`、`capabilities`、可用的 token 列和 `enabled=true`，ID 使用数据库默认 UUID。使用：

```sql
ON CONFLICT ("canonical_model_id") DO NOTHING
```

它保证迁移重复执行或审查到应用之间已有同名模型时不覆盖人工数据。aliases/default params/sort order/timestamps 使用 schema 默认值。

现有 `0014_model_catalog_sync.sql`、journal entry 和 snapshot 原样保留。新 migration 使用 journal 的下一 slot（预期 `0015_model_catalog_sync`），新 snapshot 仅推进 `id/prevId`，schema 内容不变。

## 6. 兼容、发布与回滚

- dry-run 仍可直接读取 live pi；write 仍强制本地 snapshot。
- 旧数据库可直接执行 INSERT/UPDATE 数据迁移，无 schema 变更。
- 新模型默认 enabled，但不会自动创建 Provider、model 实例或 route；管理员仍需显式绑定上游。
- 应用迁移前可直接回退代码和未应用迁移；应用后回滚代码不会破坏新增目录行，若必须撤销只能追加按 canonical ID 定向删除的 forward migration，不改写已发布 SQL。
- 不在本任务连接或迁移生产数据库。

## 7. 风险控制

- 外部目录漂移：source digest、本地 snapshot 和人工 SQL 审查保留可复现证据。
- 候选真实性：pi 只做发现；迁移发布前逐项核对厂商官方资料，direct match 不替代官方事实。
- 重复模型：官方 Provider + 前缀 + source 占用 + canonical unique + ON CONFLICT 五层去重。
- 能力误报：tools/systemPrompt 是用户确认的业务默认；vision/reasoning 仍按字段与不变量控制。
- 候选过多：SQL 逐条可审查，不做 direct apply；专项、日期和 latest 别名在单一策略入口排除。
