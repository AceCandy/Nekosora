# 设计色板统一

## Goal

将 globals.css 默认态正文基线段（`.nekusora-md` 下的 code-block / inline-code / li::marker 等）中散落的裸 `oklch(...)` 字面量，统一引用 `@theme` 设计 token，并与 DESIGN.md 色板对齐，消除魔法值、集中维护色彩语义。

## Requirements

1. 默认态正文基线段中所有裸 `oklch(...)` 字面量（背景、边框、文字色、marker 色等），改用 `@theme` token 引用：优先复用现有 token，不足处按需新增语义 token。
2. 暗色模式（`.dark`）对应规则同步对齐。
3. 圆角、阴影等非色板值不在本任务范围（仅梳理色彩）。

## Constraints

- 视觉与改造前保持一致：仅把字面量替换为等价 token，不借机调整配色（除非 DESIGN.md 明确要求对齐）。
- 不改变选择器特异性、不调整选择器结构。
- 不触碰 Shiki 代码 token 配色（其与背景配套设计）。
- 不触碰 `@theme` 块本身的 token 定义（色板源头）、不触碰 rs-xxx 输出样式段、不触碰结构化块样式。
- 新增 token（若有）须在 `@theme` 内集中定义，命名遵循现有冷调语义体系（morning-mist / deep-space / nebula-silver 等）。

## Acceptance Criteria

- [ ] globals.css 默认态正文基线段无裸 `oklch` 字面量（`@theme` 定义本身除外）。
- [ ] 明暗模式视觉与改造前一致（或与 DESIGN.md 对齐后无明显偏差）。
- [ ] 选择器特异性、结构未变；输出样式 / 结构化块 / Shiki token 未受影响。
- [ ] `pnpm lint` 通过。

## Notes

- 具体映射策略（复用现有 token vs 新增语义 token）与 DESIGN.md 色板对齐细节见 design.md（需先核对 DESIGN.md 现有色板定义）。
