# Model Catalog 同步契约强化

## Goal

把 `model_catalog` 同步收敛为一个可审计、可拒绝、可生成 forward migration 的单一 planner。外部目录只能提出有证据的变更，不能通过类型断言、模糊匹配、部分 fallback 或直接执行污染运行时目录。

用户价值：Chat 展示的推理档位、图片能力、默认/夹取结果和实际 provider 请求体始终来自同一份有效目录事实；上游能力降级能够传播，错误上游数据则被完整拦截。

## Confirmed Facts

- `model_catalog` 是模型类型、能力、思考格式和档位映射的唯一运行时事实源；UI、routing 和 provider adapter 不得维护第二份白名单。
- `src/lib/sync-pi-models.ts:310-333` 当前直接断言外部 map，并对 reasoning/vision/reasoningEffort 只升不降。
- `src/lib/sync-pi-models.ts:645-650` 与 `scripts/sync-pi-models.ts:93-115` 各自实现一次 fallback，且都只回退 `thinkingLevelMap`。
- 当前 pi payload 有 37 个 provider、1153 个模型；`reasoning` 和 `input` 当前均显式存在，339 条记录含 map，但解码器仍不能把未来缺失静默解释为 `false`。
- pi 的 `thinkingFormat` 位于 `compat.thinkingFormat`；map value 是供应商值，可为 `null` 或非空字符串，不受统一档位枚举约束。
- 当前本地目录有 510 条 chat 记录，498 条可匹配、12 条未匹配。旧 dry-run 只提出两条聚合源窗口变更；这些不是官方模型事实，不应自动落库。
- 官方资料确认两条当前能力降级：`glm-5.2` 仅文本输入；`kimi-k2` 对应的 K2 Instruct 是无长思考的 reflex 模型。
- PostgreSQL 迁移链当前为 `0000..0002`。目录修复必须追加 migration、journal 和 snapshot，不能改写历史文件。

## Requirements

- R1. 定义逐字段 authority matrix：直接官方 provider 的精确 ID 命中只产生待审 proposal；聚合商、区域变体、尾段/模糊匹配仅供审计，不能修改能力、窗口或 token 上限。任何 proposal 在提交迁移前仍必须核对厂商官方资料。
- R2. 外部解码保留 `missing / false / true` 三态。未知 map key、非 `string|null` value、空字符串、非法 compat 类型必须产生稳定 reason code，不能被 cast、过滤后或静默跳过后落库。
- R3. 匹配结果必须携带 provider、model key、match kind 和 authority。显式 `provider/id`，或在非聚合官方 provider 中唯一命中的裸 ID，才允许升降；tail/path fallback 只报告。
- R4. reasoning、thinkingFormat、thinkingLevelMap、reasoningEffort 组成原子 reasoning bundle。`reasoning=false` 规范化为删除整个 thinking bundle；其他 invariant 失败时完整保留旧 bundle，不得混用新旧字段。vision 独立按权威输入能力升降。
- R5. `off/minimal/low/medium/high/xhigh/max` 是唯一合法 key。非 fixed 的 `off` 可缺省、为 `null` 或非空供应商字符串；fixed 必须 `off:null` 且恰好一个非 `off` 档位为非空字符串。`xhigh/max` 继续只有显式配置才可用。
- R6. planner 是 dry-run、审计输出和 SQL 的唯一决策源，结果按 canonical ID 稳定排序，嵌套 JSON 使用递归稳定序列化。SQL 只能消费 accepted changes，不能重新 match/translate。
- R7. 破坏性统一同步 CLI：保留默认 dry-run 与 `--write`；删除 `--import-missing`、`--also-update`、`--apply` 和隐式网络缓存回退。`--write` 只接受显式本地 snapshot，并写 source digest；未知参数直接失败。
- R8. 本次不清空 `model_catalog`。追加幂等 PostgreSQL 数据迁移，定向删除/更新 capability key 并保留无关 JSON 字段；同步 journal/snapshot。已应用后只允许 forward fix。
- R9. 验证 catalog 到 Chat 档位、按 modelId 状态、clamp 和 compatible/provider request body 的完整链路。generic、未匹配和 reference match 必须保持原值。
- R10. CLI 不记录配置 URL、本地 snapshot 路径、raw error、payload、header、credential、cause 或 stack；审计只输出非敏感 catalog 标识、字段 diff 和稳定 reason code。

## Acceptance Criteria

- [x] 解码测试覆盖 missing/false/true、未知 key、非法 value、空串、错误 `off`、reasoning=false 携带 thinking 字段和 compat false。
- [x] 匹配测试证明 direct exact/unique bare ID 可提案，aggregate/variant/tail/歧义匹配只能审计。
- [x] reasoning/vision 的权威 true -> false、false -> true、非权威缺失保持分别有测试。
- [x] 任一 reasoning invariant 失败时旧 reasoning bundle 原样保留；vision 等独立字段不被错误回滚。
- [x] 同一输入无论对象/行顺序如何都生成相同 plan/diff；迁移 SQL 重复执行结果不变。
- [x] CLI 已移除批量导入和直接 apply，写迁移时拒绝 live source，失败输出不含 raw error、URL 或路径。
- [x] 新 PG migration 只修正官方确认的目录行，重复执行幂等，其他 capability key、catalog 行数和外键引用不变。
- [x] Chat 对不再支持 reasoning 的模型隐藏档位并忽略历史 modelId 状态；GLM 推理请求语义保持，图片能力按目录降级。
- [x] `reasoning.test.ts` 覆盖 levels/default/clamp/request body，`model-catalog.test.ts` 覆盖 SQL/journal/snapshot，sync tests 覆盖 authority/normalization/plan。
- [x] 定向 tests、lint、typecheck、全量 tests、build 和临时 PostgreSQL migration/idempotence gate 全部通过。
- [x] 规格、README、独立实现复核、隐私/数据复核与路线图状态同步完成。

## Out Of Scope

- 从 pi 批量导入 1153 条模型或新增非主流型号。
- 在前端、routing 或 provider adapter 增加模型 ID 白名单。
- 为本任务新增 catalog provenance schema；迁移仍只更新现有 `capabilities` 与数值列。
- 清空 catalog、models、conversation composer state 或其他业务数据。
- 仅为追随 pi 最新数据而改变未经官方资料确认的 provider 请求语义。
