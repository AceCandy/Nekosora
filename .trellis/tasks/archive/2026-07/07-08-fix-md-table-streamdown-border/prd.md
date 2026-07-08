# 修复 markdown 表格 streamdown 自带样式漏覆盖

## 背景

AI 输出的 markdown 表格（默认 streamdown 路径）与结构化 `TableBlock` 视觉不一致：表格内部出现一根「特别实的深色边框」。根因是 streamdown 在表格区域挂了自带 Tailwind 类（`border-border` / `bg-*` / `divide-y`），而 `globals.css` 的 `.nekusora-md` 覆盖只命中了最外层 wrapper 与 table 元素，中间层与部分属性漏网，露出深色实线与多余背景。

## Goal

清掉 streamdown 在 markdown 表格上漏盖的 3 处自带样式，使默认态 markdown 表格与结构化 `TableBlock` 视觉一致：浅色圆角外框 + 表头浅底 + 浅色行间水平线，无垂直线、无深色实线、无多余背景块。

## Requirements

- 清 `table-wrapper` 本体漏盖的 `bg-sidebar` 背景与 `p-2` 内边距（`border` 已被覆盖，保留）。
- 清 wrapper 内层 overflow 容器 div 的 `border border-border` / `bg-background` / `rounded-md`（该层无 `data-streamdown` 属性，是深色实线元凶）。
- 清 `table` 元素的 `divide-y divide-border`（ globals.css 现有 `border:0` 走 table 自身边框，压不住 divide 的子选择器边框，导致表头下方深色线）。

## 约束

- 仅改 `src/app/globals.css` 表格段；不动 `TableBlock.tsx`、不动 `customRenderer.ts`、不动 streamdown 包。
- 不破坏 paper 等输出样式：`.rs-xxx .nekusora-md` 前缀特异性更高，继续自然覆盖本基线。
- 选择器特异性须高于 streamdown 的单类（`border` 等 = `(0,1,0)`），沿用 `.nekusora-md` + 层级组合即可，无需 `!important`。
- 遵循「星枢天流」：静止无投影、无彩色粗条、morning-mist / deep-space 浅色体系。

## Acceptance Criteria

- [ ] 默认态（未选输出样式）markdown 表格：外框为 morning-mist 浅色圆角，紧贴内容；表头浅底；行间为 morning-mist 浅色水平线；无垂直线；**无任何深色实线**。
- [ ] markdown 表格与结构化 `TableBlock` 并排对比，边框/背景/行间线视觉一致。
- [ ] 选用 paper 输出样式时，表格仍呈 paper 专属外观（黑底白字等），未被本次改动破坏。
- [ ] 暗色态（`.dark`）下表格边框为 deep-space 体系，无深色实线残留。
- [ ] `npm run lint` 与项目类型检查通过（若适用）。
