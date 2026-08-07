# 技术设计

## 边界

改动覆盖 `packages/core` 公网抓取层、`apps/web` API 路由与 Markdown 展示层，不修改数据库或消息协议。服务端只返回受限的公开网页元数据，前端继续由 Streamdown、custom renderer、`MarkdownImage` 和 `MermaidDiagram` 渲染。

## 数据流

```text
Markdown.content
  -> normalizeThematicBreakSpacing
  -> separateBareUrlTrailingText
  -> collect bare HTTP URLs
  -> GET /api/link-preview?mode=probe (non-streaming, deduplicated)
  -> normalize confirmed image URLs
  -> Streamdown / custom renderer
      -> hover GET /api/link-preview?mode=metadata
      -> rich preview marker + existing safety modal
      -> MarkdownImage for explicit and promoted image URLs
      -> MermaidInlineBlock
```

## 外链浮层

- Streamdown 通过 `components.a` 使用一个 Markdown 专用链接组件，组件保留现有安全确认逻辑并标记可预览 URL。
- custom renderer 生成带安全转义 `data-preview-url` 的 `<a>`，由 Markdown 根容器的事件委托驱动同一个 Portal 浮层；这样不需要把 custom 的 `dangerouslySetInnerHTML` 改成另一套 React Markdown 树。
- 浮层位置继续使用固定定位、视口边界夹紧和短延迟关闭；保持纯信息 tooltip，原链接承担打开操作。
- hover/focus 时按需请求 `mode=metadata`，展示标题、摘要、站点名和可用 OG/Twitter 图片；客户端按 URL 去重请求，失败保留域名和完整 URL。
- 远程预览图片通过同一登录态 API 的 `mode=image` 公网代理加载，不把页面声明的任意内网图片 URL直接交给浏览器。

## 公网抓取与解析

- 复用 `public-http.ts` 的 DNS 解析、公网 IP 校验、固定 IP 连接、Host/SNI 保留和逐跳重定向校验。
- API 要求有效 session；请求超时 6 秒、最多 3 次重定向，HTML 最多读取 256 KiB，预览图片最多 3 MiB。
- `mode=probe` 只读取响应头并返回 MIME 类型；`mode=metadata` 仅对 `text/html` 读取正文并用结构化 HTML parser 提取 title/description/OG/Twitter/link icon；`mode=image` 只代理允许的栅格图片 MIME。
- API 错误不向客户端暴露远端响应正文、内部地址或底层网络异常。

## 裸图片 URL

- 在 Markdown 规范化阶段收集代码块/HTML/显式 Markdown 链接之外的裸 URL；仅非流式内容执行远端探测，避免半成品 URL 提前请求。
- 图片扩展名判断作为即时快路径；无扩展名 URL 使用 `mode=probe` 返回的 MIME 结果。列表和普通句子允许提升，代码块、HTML 标签与显式链接保持原语义。
- 转换目标是标准 `![图片](url)`，继续走现有 `MarkdownImage`，不复制图片状态逻辑。

## Mermaid 尺寸

- `MermaidDiagram` 增加可选展示 class，仅由 Markdown 正文传入，Artifact 面板维持现状。
- 正文容器保持最大高度和横向滚动；SVG 使用 `width:100%; height:auto` 填满正文宽度并保持比例。
- 不修改 Mermaid 源码、初始化主题或全屏查看器的交互状态。

## 兼容与回滚

- 所有改动可通过移除 link-preview 路由、Markdown 探测调用和 Mermaid class 回滚，不涉及持久化数据。
- custom renderer 的已有 HTML 输出格式保持不变，只增加预览数据属性；属性值始终经过现有 HTML 转义。
- 新增的 HTML parser 是唯一依赖变化；服务端出站请求只由登录态 link-preview API 发起。
