---
target: chat页面 (apps/web/src/app/chat/page.tsx)
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-08-22T05-12-18Z
slug: apps-web-src-app-chat-page-tsx
---
# Chat 页面设计评审报告（apps/web/src/app/chat/page.tsx）

**Method: dual-agent (A: agent-0 · B: agent-1)**

## 直接回答：25/40（约合 63/100）

放在 Linear / Raycast / Claude 这个顶级尺度上：底子是顶级工程素养，门面是类目通稿。globals.css 的 OKLCH 令牌、语义字阶、全局 reduced-motion 压平、动效词表是系统设计思维；但欢迎态（居中 logo + "Ask anything" + 三个建议 chip）与 ChatGPT/Claude 首屏同构。评级 band：Acceptable 上沿，Good 之下（28 分进 Good）。

## Design Health Score（Nielsen 十项）

| # | 启发式 | 分 | 关键问题 |
|---|--------|---|----------|
| 1 | 系统状态可见性 | 3 | 流式 shimmer+计时、侧栏生成中圆点都好；普通问答也被标 "Research complete · 3.6s"，状态语义失真 |
| 2 | 系统与现实匹配 | 3 | "Research/研究" 标签虚标；自动标题取成答案片段而非问题概括 |
| 3 | 用户控制与自由 | 3 | 停止/续写/编辑重发/队列取回插队/删除确认都有；删除无 undo |
| 4 | 一致性与标准 | 2 | 英文 UI 下硬编码中文 aria-label；composer 圆角 16px 超出规范 8px |
| 5 | 错误预防 | 3 | 发送被拒保留草稿、流式期 Enter 转排队防丢、删除二次确认 |
| 6 | 识别优于回忆 | 2 | 工作区全靠无文字图标（Wand2/Palette/Globe）；斜杠命令只有输入 `/` 才发现 |
| 7 | 灵活性与效率 | 2 | 全 chat 无任何键盘快捷键（无 ⌘K、⌘N、`/` 聚焦） |
| 8 | 美学与极简 | 3 | 静止零投影、留白克制；每条消息的 trace 行+完整时间戳略吵 |
| 9 | 错误识别与恢复 | 3 | role=alert 行内错误、同步失败带重试、error-shake |
| 10 | 帮助与文档 | 1 | 无引导、无快捷键提示；"输出模式 vs 渲染样式"零解释 |
| **合计** | | **25/40** | **Acceptable（20–27）** |

认知负荷：8 项检查失败 2 项（中低）——消息 hover 动作条 6–8 个控件（ChatMessageItem.tsx:578-789）；composer 右侧 4–5 个并列图标（ChatToolbar.tsx）。

## Anti-Patterns 判定

- **LLM 评估**：不会第一眼被判 "AI 做的"——双大纲轨、消息排队、过程追溯都不是模板产物。但欢迎态是唯一允许品牌动效的门面，SkyAtmosphere（18 颗 1–2px、透明度 ≤0.46 星点 + 6% 洗色）在 1440×900 下近乎纯白不可见，与登录页星图气势断层明显。
- **确定性扫描**：detect.mjs 扫 5 个页面文件 + features/chat/components/，仅 1 条 warning：ShareDialog.tsx:311 gray-on-color——判定误报（两者均带 hover: 前缀且 hover 时文字同步切换，不会同时生效）。
- **可视化 overlay**：注入成功，但 /chat 未登录 307 到登录墙，"No anti-patterns found" 针对登录页 DOM 而非聊天页本体。

## 亮点

1. 设计系统的工程化纪律：OKLCH 单亮色 + 语义字阶 + 全局 focus-visible 兜底 + 44px 触点 + 注释写明动效边界。
2. 流式期间的信息设计：过程追溯 shimmer + 实时耗时徽标 + 消息排队（取回/插队/移除），超过类目平均水平。
3. 长会话导航架构：ChatOutline 轮次大纲 + ChatResponseOutline 标题轨 + 滚动锚定；首发消息 composer 500ms expo 滑回底部是签名时刻。

## 优先问题

- **[P1] 普通回复也挂 "Research complete · 3.6s"**（MessageProcessTrace.tsx:151-175）：无 search/tool/reasoning 的闲聊被包装成"研究完成"，shimmer 文案 "Checking relevant context…" 虚构。修法：无 search/tool/reasoning 的 run 不渲染 trace 行，或改为诚实常驻签名 `模型 · 耗时 · token` 默认收起。→ $impeccable clarify
- **[P1] 键盘快捷键整体缺位**：chat 组件内无 metaKey/ctrlKey 处理；无 ⌘K、⌘N、`/` 聚焦。→ $impeccable harden
- **[P1] 用户消息编辑/删除按钮对键盘用户不可见**（ChatMessageItem.tsx:514,525）：缺 group-focus-within，Tab 聚焦只剩浮空 ring；assistant 侧做对了。→ $impeccable audit
- **[P2] 欢迎态天幕感知不到**（SkyAtmosphere.tsx）：星点尺寸/透明度提到可见阈值，或登录页星图淡引入欢迎区上半部。→ $impeccable bolder / delight
- **[P2] i18n 混层**：英文 UI 下 ChatInputBox.tsx:223 aria-label="对话输入框"、"更多设置"、"收起侧边栏" 等硬编码中文。→ $impeccable harden

## 人设红线

- **Alex（效率党）**：无快捷键；模型切换必须点开浮层；排队插队能力发现不了。
- **Jordan（新手）**：三个无文字图标概念重叠零解释；发送键位空输入时变成语音图标，实际 disabled "coming soon"，占位功能占据最高频位置。
- **Sam（无障碍）**：聚焦不可见 + 中文 aria 混层 + 语音按钮 aria-disabled 假禁用；焦点环本身及格。
- **开发者（调试路由）**：模型/耗时/token 元数据藏在 hover 动作条里；"这条走了哪条上游"不常驻可见；完整日期时间戳常显，信息优先级倒挂。

## 次要观察

composer 与用户气泡 rounded-2xl(16px) 超出规范 8px；"Ask anything" 与 ChatGPT 雷同；删除确认未点名会话标题；侧栏空态无引导；加号菜单仅一项 "Upload file" 菜单壳多余；菜单面板 border + shadow-lg 建议规范点名豁免；移动端欢迎区用户头像无容器承托。

## 值得思考的问题

1. 撤掉虚构的 "Research complete"，换诚实常驻签名 `模型 · 耗时 · token`，能否同时治好调试者与闲聊者两个病？
2. 欢迎态是唯一允许动效的门面，为什么最不可见的恰恰是它？
3. 自称"工作台"的工具，⌘K 和第三个建议 chip 哪个更值得占开发工时？
4. "输出模式"与"渲染样式"合并成一个"回复风格"入口能砍多少认知成本？

## Run Notes

slug apps-web-src-app-chat-page-tsx；无 ignore；A/B 双代理隔离；CLI 检测器 exit 2（1 发现=1 误报）；浏览器取证于全新 tab；overlay 注入成功但作用于登录墙；live-server（pid 1196789）已 kill；截图 /tmp/impeccable-b-chat.png 保留。环境勘正：3000 端口被 MoviePilot 占用，Nekosora dev 实际在 3500。评审用账号 design-review@nekusora.local 及 1 条测试会话仍在开发库中，待清理。
