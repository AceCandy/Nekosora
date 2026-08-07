# 改进 Markdown 外链图片与 Mermaid 预览

## Goal

让聊天消息中的链接、图片链接和 Mermaid 图在不改变现有安全策略的前提下更容易阅读：外链 hover 时展示网页标题、摘要和站点图片，裸图片 URL 自动展示图片，Mermaid 正文图占满可用宽度。

## Background

- Markdown 入口是 `apps/web/src/shared/components/markdown/Markdown.tsx:573-646`，同时支持 Streamdown 默认渲染器和静态 custom 渲染器。
- 外链当前由 Streamdown 的链接安全配置触发点击确认弹窗：`Markdown.tsx:92-128`；没有 hover 预览。
- 标准 Markdown 图片已经由 `MarkdownImage.tsx:16-97` 提供懒加载、失败占位、放大和下载。
- 裸 URL 当前只会渲染为链接；仅按扩展名识别无法覆盖无扩展名 CDN 图片地址。
- Mermaid 内联容器位于 `Markdown.tsx:428-510`，共享渲染器 `MermaidDiagram.tsx:59-90` 没有正文图的可读尺寸约束；DEEIX 采用正文限高并提供全屏/平移缩放。

## Requirements

### R1 外链富 hover 预览

- 对有效的 `http`/`https` 外链，在鼠标悬停或键盘聚焦时显示轻量浮层。
- 浮层展示站点域名、页面标题、摘要和可用的 Open Graph/Twitter 图片或站点图标；元数据缺失或抓取失败时退回域名和完整 URL。
- 预览内容由登录态服务端按需抓取，不使用 iframe 或第三方截图服务。
- 浮层不能改变现有外链点击安全确认行为，也不能遮挡触发链接的键盘操作。
- 浮层必须通过 Portal/固定定位避免被消息容器裁剪，离开触发器后短延迟关闭。
- 无效链接、站内锚点、脚注回链和图片元素不显示外链浮层。

### R2 裸图片 URL 自动展示

- 对绝对 `http`/`https` 裸 URL，扩展名明确时立即识别；无扩展名时在流式结束后通过服务端 `Content-Type` 探测确认图片类型。
- 将其转为现有 Markdown 图片组件渲染，复用加载中、失败占位、点击放大和下载行为。
- 列表项或普通句子中的裸图片 URL 也应展示；代码块、显式 Markdown 链接和 HTML 标签中的 URL 保持原语义。
- 图片加载失败时必须保留可见的失败状态，不得让消息布局塌陷或抛出渲染异常。

### R3 Mermaid 正文可读尺寸

- Mermaid 正文图保持比例并占满正文可用宽度，避免窄图贴在大空白容器一角。
- 正文图设置合理的最大显示高度和横向溢出策略；超出范围时可滚动或进入现有全屏查看器。
- 保留现有源码切换、复制、全屏、滚轮缩放和拖拽平移能力。
- Artifact 面板中的 Mermaid 不改变现有布局语义。

### R4 兼容与可访问性

- Streamdown 和 custom 两条渲染路径行为一致；不得破坏现有 HTML 安全过滤、链接确认和流式解析。
- 两条渲染路径中的图片都支持点击或键盘打开大图，并可复制未代理的原始图片 URL。
- 服务端 URL 抓取必须要求登录，并拒绝私网、环回、链路本地、凭据 URL、DNS 地址轮换和跳转到非公网目标；限制超时、重定向次数与响应大小。
- 浮层和图片操作支持键盘 focus-visible；图片仍提供有效 alt 文本。
- 尊重 `prefers-reduced-motion`，避免新增持续性动画。

## Acceptance Criteria

- [ ] 默认渲染器和 custom 渲染器中，hover/focus 外链可看到标题、摘要及可用站点图片；抓取失败退回 URL，点击仍走安全确认。
- [ ] 带扩展名及通过 MIME 确认的无扩展名图片裸 URL 自动显示现有图片组件；图片失败时显示失败占位。
- [ ] 普通句子或列表中的裸图片 URL 可展示；代码块、HTML 和显式 Markdown 链接不被误转。
- [ ] 默认与 custom 渲染器中的图片均可放大并复制原始图片 URL，custom 图片支持键盘打开。
- [ ] 窄 Mermaid 流程图在正文中填满可用宽度、保持比例且居中；全屏和缩放操作仍可用。
- [ ] 新增测试覆盖 SSRF、网页元数据、MIME 图片识别、两条 Markdown 路径与 Mermaid 尺寸；相关 lint、typecheck 和 Vitest 通过。

## Out of Scope

- 网页截图、iframe 预览和第三方预览服务。
- 需要登录态或 Cookie 的远程网页内容。
- 持久化 URL 元数据缓存。

## Risks / Deferred

- 部分网站缺少标准元数据或阻止服务端访问，此时只能退回域名和 URL；页面截图需另行建设浏览器渲染服务。
