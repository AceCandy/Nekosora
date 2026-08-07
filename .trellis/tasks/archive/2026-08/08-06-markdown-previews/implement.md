# 实施计划

1. 扩展 `public-http.ts` 的受限公网响应读取能力；新增 link-preview 元数据解析、鉴权 API 与 SSRF/解析测试。
2. 在 Markdown 层按 URL 去重执行非流式 MIME 探测，扩展裸图片 URL 转换到列表/普通句子；两条 renderer 继续复用 `MarkdownImage`。
3. 将 hover/focus 浮层升级为标题、摘要、站点图与 URL 的富预览，并保持现有安全确认与 Portal 定位。
4. Mermaid 正文 SVG 改为占满可用宽度并保持比例，Artifact 与全屏实例不传该 class。
5. 运行 core/web 的 lint、typecheck、Vitest 与 `git diff --check`，再独立检查 SSRF、响应式和无障碍边界。

## 风险检查点

- 在修改 Streamdown 链接组件前确认其 `components.a` props 与 linkSafety 的默认行为，避免绕过安全确认。
- 服务端抓取必须连接已校验 IP，逐跳重新校验重定向；不得用普通 `fetch(hostname)` 绕过 DNS 固定。
- 图片 URL 转换必须保护代码块/HTML 块/显式链接，且仅在非流式完成后探测，防止改变普通 Markdown 语义或提前加载。
- 远程 OG 图片不得直接交给浏览器加载未经校验的元数据 URL。
- Mermaid 尺寸只能作用于正文内联块，不能让 Artifact 面板被迫撑高。
