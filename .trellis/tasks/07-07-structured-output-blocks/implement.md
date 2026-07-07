# 执行计划：结构化代码块

> 配合 `prd.md` / `design.md`。按序推进，每段结束跑该段验证；全部完成后跑整体验收。实现前先用 `trellis-before-dev` 加载 `frontend` 规范。

## 1. 识别层 + schema

- [ ] 新建 `src/shared/components/structured-blocks/schema.ts`：zod 定义 `ChartSchema` / `MetricSchema` / `TableSchema`，导出按 kind 路由的 `parseStructured(kind, raw)`（含 `JSON.parse` + 校验，失败返回统一 fallback 信号）。
- [ ] 新建 `src/lib/artifacts/structured.ts`：定义 `StructuredKind` 与 `resolveStructuredKind(language, code)`，语言标签优先，与 `PreviewableKind` 互斥。
- 验证：`pnpm typecheck`。

## 2. 结构化块组件

- [ ] `ChartBlock.tsx`：`"use client"`，`dynamic` 引入 recharts（`ssr:false`），按 type 路由 bar/line/pie/area；配色取品牌调色板（token，无裸 hex）。
- [ ] `MetricBlock.tsx`：单值卡片 + 趋势（箭头 + 语义色 token）。
- [ ] `TableBlock.tsx`：结构化表格，支持列对齐与单元格强调。
- [ ] `index.ts`：`<StructuredBlock kind content isStreaming />`，集中处理骨架 / 成功渲染；失败交回入口降级。
- [ ] 视觉对照 `DESIGN.md`：莫兰迪冷调、无投影、无彩色粗条。
- 验证：`schema.ts` 的解析与降级单测（合法 / 非法 JSON / schema 不符 三类用例）。

## 3. MarkdownCodeBlock 分流 + 流式

- [ ] `Markdown.tsx`：将 `MarkdownPreviewContext` 值升级为 `{ onPreview?, isStreaming }`，`MarkdownImpl` 注入 `isStreaming`。
- [ ] `MarkdownCodeBlock`：入口先 `resolveStructuredKind`，命中走 `<StructuredBlock>`（`isStreaming` 控骨架/渲染），失败降级源码 + 角标；未命中走现有逻辑不变。
- [ ] 结构化块右上角复制按钮（复制原始 JSON）。
- 验证：扩展 `Markdown.test.ts`，覆盖「结构化命中内联」「未命中走预览」「非法 JSON 降级」「流式期骨架」。

## 4. outputMode seed

- [ ] `src/lib/infra/db/bootstrap.ts`：`output_modes` seed 增加固定 id 的「结构化输出」，`systemPrompt` 含 chart/metric/table 协议与示例；按 id 幂等（存在则跳过/更新）。
- [ ] 对照现有 `output_modes` seed 写法保持结构一致。
- 验证：跑 seed / 查库确认记录写入、字段正确。

## 5. 整体验收

- [ ] `pnpm lint` + `pnpm typecheck` + `pnpm test` 全绿。
- [ ] 手测：选「结构化输出」outputMode → 提数据类问题 → AI 产出 ```chart 并内联渲染。
- [ ] 手测：未选 outputMode，手动发 ```chart/metric/table 内容 → 正常内联渲染。
- [ ] 手测：发非法 JSON → 降级源码 + 角标，不崩。
- [ ] 手测：流式期骨架 → 流结束切内联，无闪烁。

## 复核要点

- 颜色无裸 hex、走 token；流式与降级有单测；未破坏 html/svg/mermaid 预览与 custom renderer；outputMode 默认不注入、opt-in。

## 回滚点

- 移除 `MarkdownCodeBlock` 结构化分流 → 降级回源码。
- 删除 outputMode seed → 移除 AI 引导。
- 二者独立，可分别回滚。
