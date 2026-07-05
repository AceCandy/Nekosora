# 代码块改为正文内联渲染并停抽普通 artifact

## 背景

当前 AI 输出的 fenced code block（``` 包裹）会被渲染两次：

1. 正文里 streamdown + Shiki 渲染一次（`github-light`/`github-dark` 主题，未配置输出样式时项目侧零适配，视觉突兀）。
2. `extractArtifacts` 把所有 ``` 无差别抽成 `kind=code` artifact，消息下方 `ArtifactInline` 又用 Prism/oneDark 渲染一次（「N 个可渲染物」折叠条）。

根因：

- `src/lib/artifacts/extract.ts` 的 `classifyLanguage` 把任何非 mermaid/svg/html/katex/markdown 的语言都归为 `code` 并抽成 artifact。
- `src/app/api/chat/route.ts` 中 `extractArtifacts(assistantText)` 只取 artifacts、丢弃去重后的 text，`message.content` 原样（含代码块）落库，正文与 artifact 各渲染一份。

业界调研（`docs/cankao` 下 4 个开源项目 + Claude 官方）：**普通代码块在正文内联渲染是统一主流**，没有任何项目做「正文 + 末尾重复」。同库参考 DEEIX-Chat（同样使用 streamdown）只在正文渲染普通代码，仅对 `html/css/js` 加「打开预览」按钮，且正文保留代码。

## 目标

- 普通代码块只在正文出现一次，消除「正文一份 + 可渲染物一份」的重复。
- 正文代码块在未配置输出样式的默认态下视觉协调（圆角、背景、字体与项目星云白/暮色黑配色搭）。
- html / svg / mermaid 等特殊类型保持现有内联预览或独立渲染，不受影响。

## 需求

1. `src/lib/artifacts/extract.ts`：让普通代码（`kind=code`）不再产生 artifact；mermaid / svg / html / katex / markdown 的识别与抽取保持不变。
2. 正文代码块美化：在默认态容器（`.nekusora-md`，不绑 `rs-xxx`）补 `pre` 的圆角 / 背景 / 边距 / 等宽字体基础样式，覆盖 streamdown/Shiki 原始外观。streamdown 自带的 Shiki 高亮与复制按钮（`controls.code.copy:true`）直接复用，不重写。
3. 样式需同时兼容亮 / 暗色，且不破坏已配置输出样式（`rs-default`/`rs-compact`/`rs-paper`）的情况——默认态样式仅在未套 `rs-xxx` 时生效，或明确让三套内置样式优先级更高。
4. 可预览类型（html / svg / mermaid 等）：代码块在正文正常显示源码与高亮，右上角加「预览」按钮，点击复用现有 `onOpenArtifact` → `ArtifactPanel` 打开右侧预览（参考 DEEIX 模式：源码在正文 + 按需预览）。移除 `ChatMessageItem` 下方 `htmlArtifacts`（`HtmlPreviewFrame`）与 `otherArtifacts`（`ArtifactInline`）的重复渲染，消除「正文 + 下方」双份。

## 验收标准

- [ ] AI 输出普通代码块（如 ```js / ```python）：正文有代码块、下方无「N 个可渲染物」折叠条、无预览按钮。
- [ ] AI 输出 html：代码块在正文正常显示（源码 + 高亮），右上角「预览」按钮可点击打开右侧面板渲染；消息下方不再重复出现 iframe 预览。
- [ ] AI 输出 mermaid：代码块在正文正常显示 + 「预览」按钮，点击打开面板渲染成图。
- [ ] HtmlPreviewFrame 高度有上限，html 用 `100vh` 等视口单位时不再无限撑高页面。
- [ ] 未配置输出样式时，正文代码块亮 / 暗色下与页面配色协调（有圆角、合理背景与边距、等宽字体）。
- [ ] 已配置 `rs-default`/`rs-compact`/`rs-paper` 时，代码块样式不被默认态样式破坏。
- [ ] 分支、搜索、RAG、消息版本切换行为不变。
- [ ] 历史 code artifact 数据不破坏（旧消息可能仍显示折叠条，可接受，本次不清理）。

## 不做（out of scope）

- 不改 html / svg / mermaid / katex / markdown 的抽取逻辑。
- 不清理历史 code artifact 数据。
- 不删除 `ArtifactPanel` / `ArtifactInline` 中针对 code 的分支（变冗余但保留，降低影响面）。
- 不引入自定义 Copy 按钮 / 折叠组件（复用 streamdown 自带能力）。

## 参考

- 同库实现：`docs/cankao/DEEIX-Chat/frontend/shared/lib/artifact-preview.ts`（窄触发：仅 html/css/js 或内容像 HTML）
- 同库样式：`docs/cankao/DEEIX-Chat/frontend/shared/components/markdown/streamdown-components.tsx`（`CollapsibleCodePre` 包装 streamdown `pre`，`[data-streamdown='code-block-body']` 选择器）
- 当前实现：`src/lib/artifacts/extract.ts`、`src/app/api/chat/route.ts`、`src/shared/components/markdown/Markdown.tsx`、`src/features/chat/components/ChatMessageItem.tsx`
