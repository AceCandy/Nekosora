# Model Catalog 同步契约强化

## Goal

强化 pi model catalog 同步的输入验证、字段权威策略、能力降级和跨字段原子 invariant，使外部目录变化不能累积过时能力或写入无效 thinking 语义，并验证 catalog 到 UI/routing/provider 请求翻译的完整链路。

## Background

- `model_catalog` 是模型能力、思考格式和档位映射的唯一事实源。
- `resolveThinkingLevelMap` 当前直接断言外部 map 类型。
- `translate` 对 reasoning/vision 只升不降，旧能力可能永久残留。
- invariant 失败只恢复 map，可能留下新 format/reasoning 与旧 map 的混合状态。

## Requirements

- R1. 明确每个同步字段的权威来源：模型 ID/别名/输入/推理能力优先官方资料，pi 用于兼容格式与档位参考，不能凭模型名猜测。
- R2. 外部 `thinkingLevelMap` 必须校验档位 key、value 类型、空串、`off`、`reasoningEffort` 与 format 的组合语义；未知/非法输入不能落库。
- R3. 当来源对某能力具有权威性时，reasoning/vision 必须支持 true -> false 降级；非权威缺失不得被误解释为 false。
- R4. invariant fallback 必须以完整 capability bundle 为原子单位，不得只回退 map 而保留不匹配的 format/reasoning/effort。
- R5. `off/minimal/low/medium/high/xhigh/max`、fixed、不可关闭和启停模型继续遵守项目目录规则。
- R6. Sync 默认支持 dry-run 和确定性 diff；未匹配、拒绝输入与 fallback 原因可审计但不泄露敏感配置。
- R7. Catalog 变更必须贯通 Chat 档位生成、按 modelId 会话状态、clamp 和 provider request body translation 测试。
- R8. 若变更目录数据，必须提供 PostgreSQL forward migration 及 Drizzle journal/snapshot；不得在前端/routing 新增能力白名单。

## Acceptance Criteria

- [ ] reasoning/vision 的权威降级、非权威缺失和新增能力分别有测试。
- [ ] 未知档位、非法 value、空串、错误 `off`、reasoning=false 携带 map 等输入被规范化或拒绝，规则有明确断言。
- [ ] 任一 invariant 失败时 capability bundle 整体保持旧值或整体采用新值，不产生混合状态。
- [ ] dry-run 对同一输入稳定，重复 apply 幂等。
- [ ] Chat UI 可用档位、默认/clamp 和 provider body 与更新后的 catalog 一致。
- [ ] generic templates 与未匹配模型不会被错误降级。
- [ ] 必要的官方资料与当前 pi payload 证据记录在 task research 中。

## Dependencies

- 技术上独立；路线图为降低并行大改风险安排在 Worker/queue 之后。

## Out Of Scope

- 无依据批量新增非主流模型。
- 在 UI 或 provider adapter 建第二份能力判断。
- 仅为追随 pi 最新默认分支而改变项目已验证的官方请求语义。

## Planning Gate

实现前必须拉取当前 `https://pi.dev/api/models`、核对项目模型与官方资料，定义逐字段 authority matrix、拒绝/回退策略和数据迁移范围，再提交 design/implement 审阅。
