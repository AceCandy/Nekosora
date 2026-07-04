# Design — 修复 custom 渲染器 HTML 块内文字被打散为段落

## 现状机制（为什么出错）

`parseMarkdown`（`src/shared/components/markdown/customRenderer.ts:38`）逐行扫描，主循环顺序为：代码块 → 空行 → `isHtmlLine` → 表格 → 标题 → 引用 → 列表 → hr → 否则 `paragraph.push`。

- `isHtmlLine`（`customRenderer.ts:24`）仅判定「整行恰好是单个 HTML 标签」（`^<\/?[a-zA-Z][\s\S]*>$` 或 `<br>`）。命中才原样透传（`142-148`）。
- HTML 容器**内部**的裸文字行不以 `<` 开头，`isHtmlLine` 判否，落入 `paragraph.push`（`212`），遇空行 `flushParagraph`（`49-53`）包成 `<p>${inlineMarkdown(...)}</p>`。
- 生成的 `<p>` 在纸面杂志下命中 `.rs-paper .nekusora-md p { color:#2a2a2a; margin:18px 0 }`（`bootstrap.ts:534`），覆盖父 `<div style="color:#cccccc">` 的内联色（`p` 自带 `color` 不再继承），并破坏行间距。

对照：代码块（` ``` `）已有「块内原样」机制（`131-134` `codeBuffer.push`）。本设计为 HTML 容器补上等价机制。

## 改动设计

### 核心思路：维护 HTML 块嵌套深度

新增局部状态 `htmlBlockDepth`（初始 0）。在主循环中，于代码块分支之后、其余解析之前插入 HTML 块处理：

```
当 htmlBlockDepth > 0：
  原样输出该行（含空行、<br>、裸文字、嵌套标签）
  htmlBlockDepth += countHtmlDelta(line)，下限 0
  continue

当 htmlBlockDepth === 0：
  计算 delta = countHtmlDelta(line)
  若 delta > 0 且 trimmed 以 "<" 开头：
    flushParagraph / closeLists / flushBlockquote
    htmlBlockDepth = delta
    原样输出该行
    continue
  否则：走原有 isHtmlLine / markdown 解析（保持现状）
```

### 深度计算 `countHtmlDelta`

遍历行内所有 `<tag>` / `<tag ...>` / `</tag>`，按规则求净变化：

| 形态 | delta |
|---|---|
| `<tag ...>`（开标签，非 void） | +1 |
| `</tag>`（闭标签） | −1 |
| `<tag .../>`（显式自闭合） | 0 |
| void 标签（`br`/`hr`/`img`/`input`/`meta`/`link`/`col`/`area`/`base`/`embed`/`param`/`source`/`track`/`wbr`） | 0 |

正则：`/<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/)?>/g`，tag 小写后查 void 集合。

### 关键边界

- **代码块优先**：`inCode` 分支在前，代码块内的 `<div>` 不计入深度。
- **HTML 块内不解析 markdown**：`depth>0` 时直接 `continue`，`**bold**` / `# 标题` / `- 列表` 等语法在 HTML 块内原样保留。与 streamdown 的 HTML 块语义一致。
- **同行开闭不进块**：`<div>x</div>`（delta=0）不进入块模式，保持原 `isHtmlLine` 透传行为。
- **void 标签不扰动深度**：单独成行的 `<br>` / `<hr>` delta=0，`depth>0` 时原样输出，`depth===0` 时仍由 `isHtmlLine` 处理。
- **文本中的 `<`/`>`**：正则要求 `<` 后跟字母，`a < b` 这类不匹配，安全。
- **进入块的条件**要求 `trimmed.startsWith("<")` 且 `delta>0`，避免「段落里夹一个 `<div>`」被误判为块开始（该边缘场景沿用现状，不在本次范围）。
- **大小写**：tag 转小写后比较。
- **HTML 注释** `<!-- -->`：不匹配（`!` 非字母），delta=0，`depth>0` 原样、`depth===0` 走 markdown（落入 paragraph，与现状一致）。

## 测试样本（身份对照）

输入（节选）：
```html
<div style="display:flex;gap:2px;...">
  <div style="flex:1;background:#1a1a1a;color:#fff;...">
    <div style="font-size:13px;line-height:1.6;color:#cccccc;">
      由 Z.ai 训练的大语言模型。<br>
      无实体、无个人记忆，基于上下文进行交互推理。<br>
      当前角色：协助你进行调试与问题排查。
    </div>
  </div>
</div>
```

改动前输出（错误）：三行正文被包成 `<p>由 Z.ai…<br></p>` 等，命中纸面杂志 `p` 规则，颜色变 `#2a2a2a`、加 18px 边距。

改动后输出（预期）：三行原样透传，无 `<p>` 包裹，继承父 `div` 的 `color:#cccccc`。

## 兼容性

- 只改 `custom` 渲染路径；`streamdown` 路径（流式 + 默认）零改动。
- 纸面杂志高级组件（`.takeaway` / `.card-grid` / `.card` / `.compare-table-wrap` 等）的典型写法以整行 HTML 标签出现，`delta` 在块内正常增减，行为不变。
- 普通 Markdown（标题/段落/列表/引用/代码/表格/hr）在 `htmlBlockDepth===0` 时走原逻辑，输出不变。

## 风险与回滚

- 风险：深度计数错误可能导致后续内容被误判为「仍在 HTML 块内」而整段不解析。缓解：`countHtmlDelta` 用保守正则 + void 白名单；单测覆盖嵌套/void/同行开闭/异常闭标签。
- 回滚：改动集中在 `parseMarkdown` 单函数，git revert 单文件即可。
