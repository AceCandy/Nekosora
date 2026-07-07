# 技术设计：结构化代码块

> 配合 `prd.md`。描述边界、契约、数据流、关键决策与兼容性，不写施工步骤（见 `implement.md`）。

## 1. 现状地基（已确认的一手事实）

消息正文经 `Markdown.tsx` 的 `Streamdown` 渲染，`pre` 被自定义组件 `MarkdownCodeBlock` 接管：

- `resolvePreviewableKind(language, code)`（`src/lib/artifacts/previewable.ts`）判定 `html` / `svg` / `mermaid` → 右上角「预览」按钮 → `onPreview(payload)` → 父组件开右侧 `ArtifactPanel`。正文始终显示源码。
- `MarkdownPreviewContext` 目前只承载 `onPreview` 回调。
- `custom renderer`（`renderer="custom"`，仅 `isStreaming=false`）把 AI 的 HTML 字符串经 `dangerouslySetInnerHTML` 注入，外层套 `rs-{cssClass}`。
- `outputMode`（`src/lib/output-modes/service.ts`）持有 `systemPrompt`，由 `orchestrator.ts` 合并进会话 system prompt；`renderStyle` 是纯渲染层（CSS + renderer），二者并列、正交。

## 2. 总体数据流

```
AI 产出 ```chart {json}``` 代码块
  → Streamdown 解析为 <pre>，交给 MarkdownCodeBlock
  → resolveStructuredKind(language) 命中 "chart"
  → 分流到内联分支：
       isStreaming=true  → 骨架占位（shimmer）
       isStreaming=false → JSON.parse → zod 校验 → <ChartBlock data>
                          失败 → 降级：源码 + 角标「解析失败」
  → 未命中 → 走现有逻辑（源码 + html/svg/mermaid 预览按钮）
```

关键决策：**结构化块走「内联渲染」，与现有 html/svg/mermaid 的「源码 + 预览按钮」是两套互斥策略**，在 `MarkdownCodeBlock` 入口分流。

## 3. 模块边界与契约

### 3.1 识别层

新增结构化类型识别，与 `PreviewableKind` 互斥（一种代码块要么内联结构化、要么走预览/源码，不重叠）：

- `StructuredKind = "chart" | "metric" | "table"`
- `resolveStructuredKind(language, code): StructuredKind | null`，语言标签优先（```` ```chart ```` / ```` ```metric ```` / ```` ```table ````）。
- 落点：`src/lib/artifacts/structured.ts`（独立模块，避免 `previewable.ts` 职责膨胀）。

### 3.2 渲染层（MarkdownCodeBlock 分流）

`MarkdownCodeBlock` 顶部先判 `resolveStructuredKind`：

- 命中 → 内联分支（骨架 / 组件 / 降级源码），**不再**走源码 + 预览按钮。
- 未命中 → 现有源码 + `resolvePreviewableKind` 预览按钮逻辑，行为不变。

`isStreaming` 信号透传：将 `MarkdownPreviewContext` 的值由「单回调」升级为对象 `{ onPreview?, isStreaming }`，由 `MarkdownImpl` 注入（它已持有 `isStreaming` props）。`MarkdownCodeBlock` 消费 `isStreaming` 决定骨架 or 解析。

### 3.3 结构化块组件

新建 `src/shared/components/structured-blocks/`：

- `schema.ts`：zod schema —— `ChartSchema`（type 枚举 bar/line/pie/area、title、series、data、轴 key 等）/ `MetricSchema`（label、value、unit、trend、delta）/ `TableSchema`（columns 含 align/emphasis、rows）。
- `ChartBlock.tsx`：`"use client"`，`dynamic(() => import("recharts"), { ssr:false })`，按 `type` 路由到 `BarChart` / `LineChart` / `PieChart` / `AreaChart`。配色取自品牌调色板（见 §4）。
- `MetricBlock.tsx`：单值卡片，趋势用箭头 + 语义色 token。
- `TableBlock.tsx`：结构化表格，列对齐与强调走 token。
- `index.ts`：导出路由组件 `<StructuredBlock kind content isStreaming />`，内部集中处理「骨架 / 解析 / 校验 / 降级」，对外只暴露 `kind` + `content`。

降级约定：`StructuredBlock` 内部 `try { JSON.parse → schema.parse } catch` 失败时，返回 `{ __fallback: true }` 信号，由 `MarkdownCodeBlock` 回退为源码渲染 + 角标。保持「降级决策在入口、组件只管渲染成功态」的单一职责。

### 3.4 outputMode seed

`src/lib/infra/db/bootstrap.ts` 的 `output_modes` seed 增加一条「结构化输出」：

- 固定 `id`（便于引用与幂等），`enabled: true`，`sortOrder` 排在合理位置。
- `systemPrompt` 内容：说明何时用结构化代码块（数据展示、指标、对比表）+ chart/metric/table 的最小 schema 示例 + 「其余正文仍用 markdown」。
- `outputMode` 表无 `builtin` 字段，幂等以 `id` 为准（seed 前先按 id 查存在则跳过/更新）。

实现时对照 `bootstrap.ts` 现有 `output_modes` seed 写法保持一致。

## 4. 配色与设计 token

recharts 默认色为 hex，须映射到品牌语义色，避免裸 hex（frontend spec）：

- 在 `structured-blocks/` 内定义调色板数组，值取自 `globals.css` `@theme` 已注册的语义 token（如 `sora-blue` / `nebula-*` 等冷调），实现时以 `trellis-before-dev` 读取的 `globals.css` 实际 token 为准。
- 卡片、表格遵循 `DESIGN.md`：莫兰迪冷调、无投影、无彩色粗条。

## 5. 安全

- 全程 `JSON.parse` + zod 校验 → 受控 React 组件，**不走 `dangerouslySetInnerHTML`**。
- 相比 custom renderer 的裸 HTML，本路径无 XSS 注入面，是正向收益。
- recharts 仅消费经过校验的数据。

## 6. 流式策略

沿用现有「custom renderer 仅在非流式启用」的成熟模式：

- `isStreaming=true`：结构化块一律骨架占位（不解析 JSON，杜绝半截 JSON 闪烁）。
- `isStreaming=false`：一次性解析内联。
- 该策略与 streamdown 自身的 streaming 容错独立、不冲突。

## 7. 兼容性

- 现有 html / svg / mermaid 预览：不变（`resolveStructuredKind` 与 `resolvePreviewableKind` 互斥，入口分流）。
- custom renderer / render-styles：不变。
- `extractArtifacts`：本期不纳入结构化块（Out of Scope）。
- 未选 outputMode 的会话：前端渲染能力依旧生效（AI 自发输出也能渲染）。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| recharts 包体积 | `dynamic import` + `ssr:false`，仅在使用时加载 |
| AI 输出 JSON 不规范 | zod 校验 + 降级源码，单块 `ErrorBoundary` 兜底 |
| 流式抖动 | 结构化内联仅在 `isStreaming=false` 启用，可回退为「仅源码」 |
| outputMode 误开启影响默认会话 | seed 为独立记录，默认会话不选即不注入；删除 seed 即移除引导 |
| 识别与预览冲突 | 两套 kind 互斥，入口分流，互不重叠 |

回滚点：移除 `MarkdownCodeBlock` 的结构化分流分支 → 自然降级回源码；删除 outputMode seed → 移除 AI 引导。二者独立可回滚。
