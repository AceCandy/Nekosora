# 结构化代码块：chart/metric/table 内联渲染与 outputMode 引导

## Goal

让 AI 用 fenced code block + JSON 输出结构化数据，前端按 `chart` / `metric` / `table` 三类在消息正文内联渲染（图表用 recharts），并 seed 一个内置 `outputMode` 引导 AI 主动产出。复用现有「代码块识别」通道，走「JSON → 受控 React 组件」，不引入 DSL，也不走 custom renderer 的裸 HTML（更安全）。

## Background

参考 TokUI「结构化输出 → 注册组件渲染」的范式，但载体换成模型原生就会的 fenced code block + JSON，避免教模型新 DSL 的成本与整条数据链路的改造。与现有 `outputMode`（生成层）+ `renderStyle`（渲染层）的分层契合：协议归 `outputMode`，前端识别渲染常开、不依赖 `outputMode`。

## Requirements

1. AI 可用 ```` ```chart ```` / ```` ```metric ```` / ```` ```table ```` 代码块 + JSON 描述结构化数据。
2. 前端识别这三类代码块，**正文内联**渲染为受控 React 组件（不显示源码、不走 `dangerouslySetInnerHTML`）：
   - `chart` → recharts，支持 bar / line / pie / area
   - `metric` → 单值指标卡片（label / value / 单位 / 趋势）
   - `table` → 结构化表格（columns / rows，支持列对齐与单元格强调）
3. **流式安全**：流式接收期（`isStreaming=true`）对结构化块显示骨架占位；流结束后（`isStreaming=false`）解析 JSON 并内联渲染，避免半截 JSON 闪烁。
4. **容错降级**：JSON 解析失败或 schema 不符 → 回退为普通代码块源码 + 角标提示，单块错误不炸整条消息（已有 `ErrorBoundary` 兜底）。
5. **seed 内置 outputMode「结构化输出」**：`systemPrompt` 含 chart/metric/table 协议规范（何时用、schema 示例），用户在工具栏选用即注入。
6. **渲染能力常开**：前端结构化块识别与渲染不挂接到 `outputMode` 开关。即便未选该 outputMode，AI 自发输出 ```` ```chart ```` 也能正常渲染。
7. 结构化块保留「复制原始 JSON」能力。

## Constraints

- 颜色使用设计 token，不出现裸 hex（recharts 配色映射到 `globals.css` `@theme` 的品牌语义色）—— 遵循 frontend spec。
- schema 用 zod 做边界校验 —— 遵循 frontend spec。
- 流式行为改动须补单测 —— 遵循 frontend spec。
- 视觉遵循 `DESIGN.md`「星枢天流」：莫兰迪冷调、卡片克制无投影、不出现彩色粗条 / Eyebrow 眉标。
- 不引入 TokUI DSL 或其 npm 包；不改动现有 custom renderer / render-styles / html-svg-mermaid 预览链路。
- 不改变默认会话行为：结构化协议通过 outputMode opt-in，默认不注入。
- recharts 走 `dynamic import`（`ssr:false`），避免打入首屏 bundle。

## Acceptance Criteria

- [ ] 选用「结构化输出」outputMode 后，AI 对数据展示类问题产出 ```` ```chart/metric/table ```` JSON。
- [ ] ```` ```chart ```` JSON 正确渲染为 recharts 图（bar/line/pie/area 各验证一种），配色为品牌 token。
- [ ] ```` ```metric ```` 渲染为单值指标卡片（含趋势方向）。
- [ ] ```` ```table ```` 渲染为结构化表格。
- [ ] 流式期结构化块显示骨架，流结束切到内联渲染，无抖动 / 闪烁。
- [ ] 非法 JSON 或 schema 不符 → 降级源码 + 角标提示，页面不崩、不波及兄弟消息。
- [ ] 未选 outputMode 时，手动输入 ```` ```chart ```` 内容也能正常内联渲染。
- [ ] 结构化块右上角复制按钮可复制原始 JSON。
- [ ] `pnpm lint` + `pnpm typecheck` + `pnpm test` 通过；流式分流与降级有单测覆盖。

## Out of Scope

- `timeline` / `steps` / `form` 等更多结构化类型（留待后续迭代）。
- 结构化块「点开抽屉看大图 / 可交互」（留待后续迭代）。
- 引入 TokUI DSL 或其 npm 包；改造 custom renderer / render-styles。
- 将结构化块纳入 `extractArtifacts` 落库（留待后续迭代）。
