# 生成内容渲染安全设计

## Design Principles

1. 管理员明确接受的 custom renderer 能力保持兼容，不用技术拦截替代产品决策。
2. 模型 artifact 不具备管理员配置前置审查，必须与应用主页面源隔离。
3. 复用现有 iframe/CSP/sandbox，避免新增 sanitizer、CSS parser 或另一套预览组件。
4. 风险提醒靠近实际配置，持续可见但不增加确认流程。

## Trust Boundary Matrix

| 内容 | 来源 | 当前/目标边界 | 本任务行为 |
|---|---|---|---|
| 默认 Streamdown | 模型消息 | Streamdown hardening | 保持现状 |
| custom renderer HTML | 模型消息 + 管理员启用样式 | 应用主 DOM，未净化 | 保持现状，管理端提醒并记录剩余风险 |
| render style CSS | 管理员 | 聊天页/分享页原样注入 | 保持现状，补充影响范围提示 |
| HTML artifact | 模型 fenced block | opaque-origin iframe + CSP | 保留 iframe，移除顶层 Blob 打开 |
| SVG artifact | 模型 fenced block | 当前主 DOM | 改为复用 HTML artifact iframe |
| artifact 下载 | 用户主动操作 | 下载文件 | 保持现状 |

## Admin Warning Flow

### Data Contract

`RenderStylesSection` 已从数据库取得 `renderer`，但当前投影到 Client Component 时丢弃。补齐现有字段即可：

```ts
interface RenderStyle {
  // existing fields...
  renderer: "streamdown" | "custom";
}
```

不修改数据库、service 写接口或创建表单。普通新建样式继续使用数据库默认 `streamdown`；内置 `paper` 继续由 bootstrap 指定 `custom`。

### List State

当 `style.renderer === "custom"` 时，在样式名称旁复用 `Badge variant="warning"` 显示“高信任渲染”。Badge 使用现有 Neku Amber 状态色和简短 title，不增加新列、卡片或弹窗。

### Edit State

编辑 custom 样式时，在表单字段前显示一条 `role="note"` 的内联提示：

> 此样式会原样渲染模型生成的 HTML，并同步用于公开分享。请仅在模型与内容来源可控时启用。

提示使用完整细边框、浅 warning 背景、`ShieldAlert` 图标和正文级可读文字；不使用彩色侧边粗条，不要求勾选确认，不改变保存/启停逻辑。新增样式默认不是 custom，因此新增表单不显示该提示。

CSS 字段原有提示改为明确“原样应用于聊天和公开分享”，不做语法扫描。

## Artifact Isolation

### SVG

`ArtifactPanel` 的 SVG 分支由主 DOM `dangerouslySetInnerHTML` 改为：

```tsx
<HtmlPreviewFrame html={artifact.content} />
```

`buildHtmlPreviewDoc` 会把 SVG 片段放入完整 `srcDoc`，现有 `sandbox="allow-scripts"` 不含 `allow-same-origin`；CSP 继续禁止 connect、frame、object、base 和 form。SVG 可继续显示和执行隔离内交互，但不能访问父页面 DOM 或应用存储。

### Top-Level Open

`HtmlPreviewFrame` 当前唯一调用者是 `ArtifactPanel`，而面板工具栏已经提供下载。因此直接删除 `ExternalLink`、Blob URL、`window.open` 和两个外部打开按钮，不新增替代弹窗或 viewer route。用户仍可在 sandbox 中预览，也可显式下载源文件。

## Compatibility

- custom Markdown 的 parser、DOM 输出、会话状态和分享快照不变。
- render style 创建/更新 action 与数据库 schema 不变。
- HTML artifact 的 `srcDoc`、高度 bridge 和 sandbox 不变，只移除顶层打开入口。
- SVG 从主 DOM 移入 iframe，页面 CSS 不再直接作用于 SVG；artifact 自身样式继续在 iframe 内生效。
- Mermaid、代码、KaTeX、Markdown artifact 不变。

## Tests

- 管理 UI：custom 样式显示“高信任渲染”标识和编辑提示；streamdown 样式不显示 custom 提示；保存 action 不增加确认参数。
- Artifact：SVG 分支渲染 iframe，sandbox 包含 `allow-scripts` 且不包含 `allow-same-origin`；不再渲染主 DOM SVG。
- HTML preview：不再存在 `window.open`/Blob 外部打开按钮；CSP、bridge 和高度消息保持现有纯函数测试。
- i18n：中英文新增 key 同步。

## Rollout And Rollback

- 无数据库迁移、环境变量或部署顺序要求，可随 Web 制品发布。
- 若 iframe 导致特定 SVG 显示回归，只回滚 SVG 分支并保留管理提醒与外部打开移除；不得在未重新评估 XSS 的情况下长期恢复主 DOM 注入。
- 若提醒影响布局，只调整提示排版，不回滚 renderer 数据透传或风险文档。

## Rejected Alternatives

- custom HTML/管理员 CSS sanitizer：违背已确认产品决策。
- CSS 风险扫描器：启发式误报高，当前只有管理员写入口，超出最小提醒需求。
- 保存确认或启用弹窗：增加阻断且不能真正消除模型输出风险。
- 新建 SVG sanitizer/预览组件：已有 sandbox 能满足主源隔离，新增依赖和重复组件没有必要。
