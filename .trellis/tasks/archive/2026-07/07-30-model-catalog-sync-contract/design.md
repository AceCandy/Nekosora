# Model Catalog Sync Contract Design

## 1. Design Intent

同步器不再是“抓取后尽量合并”的脚本，而是一个明确的信任边界：decode 外部数据，classify 匹配证据，normalize capability bundle，validate invariants，最后生成唯一 plan。CLI 只能渲染或持久化这个 plan。

目标数据流：

```text
pi payload (unknown)
  -> decoder + rejection codes
  -> evidence-aware matcher
  -> field authority resolver
  -> atomic capability normalizer
  -> deterministic CatalogSyncPlan
       -> dry-run report
       -> PostgreSQL forward migration

model_catalog -> Chat levels/state/clamp -> provider request translation
```

## 2. Ownership Boundaries

- `src/lib/sync-pi-models.ts` 拥有外部解码、匹配证据、authority、bundle invariant、deterministic plan 和 SQL 片段。
- `scripts/sync-pi-models.ts` 只拥有 source IO、参数解析、DB snapshot 读取、报告渲染和 migration 文件写入。
- `src/lib/reasoning.ts` 继续独占运行时档位、默认、clamp 与 provider 参数翻译；同步器只能调用其公开档位投影，不复制 UI/provider 判断。
- PostgreSQL `model_catalog` 继续是唯一运行时事实源；pi payload 和 task research 不是运行时配置源。

## 3. Evidence-Aware Matching

`MatchResult` 改为结构化证据：

```ts
type MatchKind = "provider-id" | "unique-bare-id" | "path" | "tail";
type MatchAuthority = "direct" | "reference";

interface MatchResult {
  pi: DecodedPiModel;
  provider: string;
  modelKey: string;
  kind: MatchKind;
  authority: MatchAuthority;
}
```

判定规则：

1. catalog canonical/alias 精确写出 `provider/id`，且 provider 非 aggregate/variant：`direct`。
2. 裸 ID 在非 aggregate/variant provider 中只有一个精确 model key/id 命中：`direct`。
3. aggregate/variant、全路径 owner 推断、tail 归一或多官方 provider 歧义：`reference`。
4. `reference` 仍出现在 dry-run 审计，但不会进入 accepted changes。

这使 `glm-5.2` 与 `kimi-k2-0711-preview` 的直接事实可提案，同时阻止 OpenRouter 的 context/max 自动覆盖目录。

## 4. Field Authority Matrix

| Field | Direct proposal | Reference proposal | Missing semantics |
| --- | --- | --- | --- |
| canonical ID / aliases | 本任务不修改 | 不修改 | preserve |
| reasoning | 可 true/false 升降，提交前核对官方资料 | audit only | preserve |
| vision (from input) | 可 true/false 升降，提交前核对官方资料 | audit only | preserve |
| thinkingFormat | 仅合法 direct compat 值；curated KEEP 受保护 | audit only | preserve |
| thinkingLevelMap | direct、非 aggregate format、完整校验后可采用 | audit only | preserve |
| reasoningEffort | compat 显式 true/false 且 format 组合合法时可升降 | audit only | preserve |
| context/max tokens | direct only | audit only | preserve |

`direct` 只是可写 proposal 的结构证据，不替代人工官方资料门禁。删除 `--apply` 后，proposal 必须成为可审查 migration 并通过 task research/测试才能进入数据库。

## 5. Decode And Presence Contract

- parser 不再把缺失 reasoning 变成 false，也不把 compat false 变成 undefined。
- model 级基础形状非法时加入 `rejections`，不静默跳过；单模型 rejection 不阻断其他合法模型的 dry-run。
- `thinkingLevelMap` 必须是普通对象；key 只能来自七档集合；value 只能是 `null` 或 trim 后非空字符串。任一 entry 非法则整个 map rejected，不做局部过滤。
- reason code 使用稳定枚举，如 `invalid_map_key`、`invalid_map_value`、`invalid_compat_boolean`、`ambiguous_direct_match`，报告不携带 raw payload/error。

## 6. Atomic Capability Bundle

reasoning bundle 定义为：

```text
reasoning + thinkingFormat + thinkingLevelMap + reasoningEffort
```

规则：

- direct `reasoning=false` 具有支配性：删除 reasoning 与全部 thinking 字段，外部残留 format/map 只记 normalization reason，不写入。
- direct `reasoning=true` 时，先形成完整候选 bundle，再统一校验。
- fixed 要求 `off:null` 且恰好一个非 off 非空字符串；非 fixed reasoning 至少有一个运行时可用档。
- `reasoningEffort` 只允许出现在确实消费独立 effort 的 format 组合；fixed/toggle-only 组合拒绝。
- 候选 bundle 失败时，旧 bundle byte-semantically 保留；不会只恢复 map。
- vision 是独立输入 capability，可在 reasoning bundle rejected 时单独收敛。
- false capability 使用删除可选 key 的 canonical representation，避免在 JSON 中累积 `false` 与缺省两种等价状态。

## 7. Deterministic Plan

`CatalogSyncPlan` 包含稳定排序的：

- `changes`: accepted field operations (`set` / `delete` / numeric update)。
- `rejections`: model + stable reason code + affected bundle。
- `references`: 非权威匹配与其 proposal，仅审计。
- `unmatched`: generic 与真实未匹配分开计数。

递归 canonical JSON serializer 负责嵌套 map/diff；DB rows、provider keys 和 payload key 的输入顺序不影响结果。SQL builder 只消费 `changes`，删除脚本中的第二套 match/translate/fallback。

## 8. CLI Contract

保留：

- 无 flag：从 live endpoint 或显式 `PI_MODELS_FILE` 读取并 dry-run。
- `--write`：只允许显式本地 snapshot，生成 SQL + journal + snapshot。

删除：

- `--import-missing` / `--also-update`：目录新增回到官方资料 + 显式 migration 流程。
- `--apply`：禁止绕过 migration 事务与代码审查直接逐条更新。
- 自动 cache/fallback：网络失败明确失败；离线重放显式指定 snapshot。

写入 migration 时记录 payload SHA-256，不记录 URL 或本地路径。参数未知、live write、decode fatal error 都以固定 stage/reason 输出并非零退出；finally 关闭 DB。

## 9. SQL And Data Migration

- 不变更 schema，不清空任何表。
- 追加 `0003_*` 数据 migration、journal entry 和 snapshot successor。
- 对已有行使用定向 `UPDATE`，capabilities 通过 JSONB key delete + patch 保留其他字段；不做全对象覆盖，也不 insert 缺失模型。
- 每个实际变更同步写 `updated_at = now()`；无 accepted operation 的行不触碰时间戳。
- 本次预期数据影响：
  - `glm-5.2`: 删除错误的 `vision` capability，保留已验证的 reasoning 语义。
  - `kimi-k2`: 删除 `reasoning` 与 thinking bundle，保留 tools/systemPrompt 等无关能力。
- SQL 可重复执行；若已应用后发现问题，只追加 forward-fix migration。

## 10. Consumer Compatibility

- ChatToolbar 继续通过 `getSupportedReasoningLevels` 动态生成档位，无组件白名单。
- `reasoningByModelId` 不清理；旧 Kimi 选择经 `resolveReasoningForModel` 收敛到 `off`，且 provider body 因 reasoning disabled 保持原样。
- GLM reasoning level/map 与 compatible body 不改；仅附件编排读取 `vision !== true` 后拒绝图片。
- generic 和 reference rows 保持原目录值，避免因 pi 聚合源缺失/差异造成大面积降级。

## 11. Rollback And Risk

- 代码/未应用 migration 可按 child commit 回滚。
- 已应用 migration 只能 forward fix；旧 capability 值已记录在生成 migration review 与测试 fixture 中。
- 主要风险是 direct match 的上游事实仍可能错误；通过严格 match、官方资料核对、无 direct apply、两阶段 migration review 降低。
- 删除旧 CLI flags 是有意破坏兼容；README 与错误测试必须同步，不能留隐藏兼容分支。
