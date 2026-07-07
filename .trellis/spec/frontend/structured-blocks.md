# 结构化代码块渲染契约

> AI 在 fenced code block(```chart / ```metric / ```table / ```callout)内输出 JSON，前端 zod 校验后交受控 React 组件渲染。颜色由前端按品牌调色板分配，schema 不收 AI 色值。

---

## 类型识别

`resolveStructuredKind(language)` 把语言标签映射为四类：`chart` / `metric` / `table` / `callout`。它与 `resolvePreviewableKind`（html/svg/mermaid 预览）**互斥** —— 一种 fenced block 要么走结构化内联，要么走预览/源码，不重叠。

## schema 边界（`structured-blocks/schema.ts`）

- **chart**：`type` ∈ bar/line/pie/area，`series` + `data`。
- **metric**：兼容单对象与数组（多指标横排渲染）。
- **table**：`columns` + `rows`，列可 `align` 与 `emphasis`。
- **callout**：`type` ∈ warning/tip/note/error + 可选 `title` + `body`。
- 校验失败统一返回 `{ ok: false, reason }`，由入口降级为源码展示。

## 双渲染链路

- **streamdown（默认渲染器，流式期生效）**：经自定义 `pre` 组件识别 language → `StructuredInlineView` 内联渲染。
- **custom（输出样式渲染器，流式结束后生效）**：`splitStructuredSegments` 按 fenced 块切段，结构化段交 `StructuredInlineView`，markdown 段交 `parseMarkdown`。
- 两条链路共用 `StructuredInlineView`，集中「骨架 / 受控组件 + 复制 / 解析失败降级源码」三态，避免重复实现。

## 流式渐进

`StructuredInlineView` 流式态：先 `parseStructured` 尝试解析累积内容，**成功就渲染、失败静默骨架**（不报错闪烁）。fenced 块闭合即出，不必等整条消息流完；流式态不显示复制按钮（内容仍在变）。半截 JSON 几乎不可能 `JSON.parse` 成功，故无需额外防抖。

## 降级

解析失败 → 原始源码 `<pre>` + `AlertTriangle` 失败角标，保留 AI 输出可见性。

## 视觉约束（遵循「星枢天流」）

- 静止状态无投影；**严禁侧边彩色粗条**等 AI 模板痕迹 —— callout 仅靠图标与标题色区分类型，背景保持中性。
- 字色：`nebula-silver`(oklch 0.96) 是**暗色模式专用浅白文字**，不可用于亮色背景；亮色次级文字用 `neutral-500/600`，暗色用 `neutral-300/400`；数值主色亮色 `space-ink`、暗色 `nebula-silver`。
