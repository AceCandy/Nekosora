# Nekosora vs DEEIX-Chat 渲染视觉排版对比(深度分析)

> 研究底稿。对比「聊天消息 / Markdown 渲染」的视觉排版实现,覆盖正文普通样式、代码样式、文本元素、可视化、流式、主题/字体/安全。
> 数据来源:Nekosora 侧以当前磁盘代码为准(`src/app/globals.css`、`src/shared/components/markdown/Markdown.tsx`、`src/features/chat/components/ChatMessageItem.tsx`);DEEIX-Chat 侧以 `docs/cankao/DEEIX-Chat/frontend` 为准。
> 日期:2026-07-16。

---

## 0. 共同基座

- 同渲染器:`streamdown@2.5.0` + Shiki(`github-light`/`github-dark`)。
- 都用 Tailwind 任意选择器把 streamdown 原生外壳(code-block / table / mermaid 容器)系统性「清零重写」。
- 都允许 AI 输出带 `style` 的内联 HTML 块(div/section/article/aside/main/details/summary/span/p),并做白名单过滤。
- 都走 OKLCH 色彩 + Tailwind v4 `@theme` + `.dark` class 暗色。

**根本分歧**:Nekosora = 窄列阅读 + 冷调克制 + 逐字淡入动画 + 结构化图表块 + 单套暗色;DEEIX = 宽幅文档感 + 暖灰/橙赭多主题 + 关动画用圆点光标 + 强内容预处理 + LaTeX/图片富交互。

---

## 1. 渲染基座

| 维度 | Nekosora | DEEIX-Chat |
|---|---|---|
| 插件 | streamdown 内置(GFM/Shiki/KaTeX/Mermaid),无独立插件包,无 CJK 插件 | `@streamdown/cjk`(中日韩排版)+ `@streamdown/code` + `@streamdown/math` + `@streamdown/mermaid`,**按内容检测懒加载** |
| rehype 链 | streamdown 默认(含 harden) | 自建 5 步:HTML 内嵌数学 → raw → sanitize 扩展 → **裸链接转 `<a>`** → harden |
| 内容预处理 | 无 | 大量正则归一化:数学分隔符 `\(\)`→`$`、货币 `$1,234` 防误判、Unicode→LaTeX、Mermaid `<br>`、HTML 块内空行修复 |
| CSS 引入 | 自己重写 `globals.css`(streamdown 默认依赖项目未定义的 `--border/--sidebar` 而失效) | `import "streamdown/styles.css"` + `katex.min.css`,再覆盖 |
| 自定义组件 | `pre`→代码块 + HTML 标签 | 14 个全量覆盖(`a/img/p/pre/strong/b` + HTML 标签);思考态把 `h1-6` 降级为 `<p>` |

---

## 2. 正文区域 / 排版

| 维度 | Nekosora | DEEIX-Chat |
|---|---|---|
| 消息最大宽度 | `max-w-[75ch]`(窄列,大呼吸感) | `max-w-[1080px]`(固定宽幅,文档感) |
| 正文字号 | `text-sm` = 14px | `text-[15px]` = 15px |
| 正文行高 | `leading-relaxed` ≈ 1.625 | `leading-8` = 2.0(32px) |
| 正文色 | `text-neutral-800 / dark:neutral-200`(中性灰) | `text-foreground`(暖褐黑 oklch) |
| 断行 | 默认 | `[overflow-wrap:anywhere]` |
| 气泡 | assistant 无气泡(纯文字);user 深色气泡 `rounded-2xl bg-neutral-900` | assistant 无气泡 |
| 段落间距 | `p { margin: 0.85em 0 }` | `space-y-3`;消息间 `space-y-6` |
| 字体 | 系统字体栈(ui-sans-serif/system-ui),无自定义加载 | Geist + Geist_Mono + JetBrains_Mono(next/font),可切宋体/黑体 |

**深度分析**:
- **动机**:Nekosora 的 75ch + 14px 是「大呼吸感」设计原则的落实(75ch 为阅读舒适区上限);DEEIX 的 1080px + 15px/2.0 是「文档/阅读器」取向(单屏内容更多,宽表格/长代码不折行,超大行高补偿宽列回扫)。
- **权衡**:窄列 → 长回答需更多纵向滚动,宽表格/长代码被截断需横滚;宽幅 → 大屏单行超 90 字符回扫吃力(DEEIX 用 2.0 行高补偿)。
- **结论**:聊天工作台定位下**坚持 75ch**。可取经 DEEIX 的「字号/行高可调」做**可访问性**(1-2 档克制缩放,非个性化)。

---

## 3. 代码块

| 维度 | Nekosora | DEEIX-Chat |
|---|---|---|
| 外层底色 | `--color-prose-code-bg`(极浅冷灰)+ 1px border | `bg-muted/40`,无 border |
| 圆角 | 12px | `rounded-xl`(≈12px) |
| 投影 | `0 1px 2px /0.04`(暗色 /0.3) | 无 |
| 字号/行高 | 13px / 1.6 | 13px / 1.54(20px) |
| 语言标签 | 头部标签条(居中融合) | 靠左 `text-[11px] tracking-[0.06em]` |
| 长代码 | **不折叠** | **>16 行自动折叠** + 渐隐遮罩 + 展开按钮 |
| 复制/预览 | 右上悬浮(hover 显,触屏常显) | 右上胶囊 `bg-background/80 backdrop-blur` |
| 行号 | 无 | 无 |
| 行内 code | `prose-inline-bg` + 4px 圆角 + 0.9em | `bg-foreground/5` + rounded-md + 0.92em |

**深度分析**:Nekosora 长代码全展开,正文易被撑很长 → **16 行折叠 + 渐隐遮罩是最值得取经的点**(纯前端、成本低、收益大)。

---

## 4. 文本元素

| 元素 | Nekosora(显式基线) | DEEIX-Chat |
|---|---|---|
| 标题 h1-4 | 显式字号(h1 1.45em…h4 1em)、font-weight 650 | 未显式覆盖字号(streamdown 默认) |
| 粗体 | font-weight 650、color space-ink | font-weight 700(`--font-chat-strong-weight`) |
| 引用 | `border-left 2px morning-mist` + padding | streamdown 默认(思考态去左边框) |
| 列表 | `padding-left 1.5em`、marker 灰 | streamdown 默认 |
| 表格 | morning-mist 圆角外框 + 表头浅底 + 行间水平线(清掉 streamdown 深色线) | 无外框/无背景,仅行底线(`border-table-border`) |
| 链接 | sora-blue(冷蓝)+ 下划线 + offset 2px | primary(暖橙赭)+ 下划线,外链弹安全确认 Dialog |
| 分割线 | `border-top morning-mist` | streamdown 默认 |
| 脚注 | 无专门处理 | 有(脚注区 + 回引用图标) |

**深度分析**:Nekosora 全套显式写死(因 streamdown 默认失效);DEEIX 依赖默认 + 选择性去样式。**坚持 Nekosora 自写基线**(品牌一致性)。注意特异性 cascade:基线 `.nekusora-md [data-streamdown=…]` 为 (0,2,0),低于皮肤 `.rs-xxx .nekusora-md …` 的 (0,3,1)。

---

## 5. 可视化(互补)

| 能力 | Nekosora | DEEIX-Chat |
|---|---|---|
| 结构化图表块 | **独有**:`chart/metric/table/callout` fenced JSON → zod 校验 → recharts 品牌色图表(骨架/成功/降级三态);颜色前端分配,schema 不收 AI 色值。详见 `spec/frontend/structured-blocks.md` | 无 |
| Mermaid | 内联出图(theme base + 冷调蓝灰 + look neo),流式中显源码、结束后出图 | 去外壳 + panZoom/fullscreen/copy,max-h-280,htmlLabels:false |
| 数学 KaTeX | streamdown 内置 | `@streamdown/math`,可点击复制 LaTeX,分数线修复 |
| 图片 | 无专门 Markdown 图片组件 | 富交互:rounded-xl + hover 浮窗(放大/下载/生成)+ Dialog 放大 + 受保护图 blob + 加载/失败占位 |
| HTML 内嵌 | style 白名单过滤 | style 过滤(~100 安全属性)+ **纯黑/白映射到 var(--foreground/background)** + HTML 内 `$...$` 二次渲染 |

**深度分析**:Nekosora 的结构化块是 DEEIX 没有的护城河(数据可视化问答),**继续强化**(可借 DEEIX 的 fullscreen/panZoom 给 chart 加交互)。DEEIX 在图片/LaTeX/代码折叠的确定性富交互上更完备 → 取经挑低成本的(代码折叠优先)。

---

## 6. 流式渲染策略(与 A/B 任务直接相关)

| 维度 | Nekosora | DEEIX-Chat |
|---|---|---|
| 逐 token 动画 | `animated={fadeIn, sep:char, stagger:30}`(开启) | `animated={false}`(三处全部硬关闭) |
| 光标 | `caret="block"`(方块) | `caret="circle"`(圆点) |
| 流式感来源 | 逐字 fadeIn + store rAF 合批(每帧 content 全量重解析) | 纯靠 isAnimating + 圆点光标,无字符动画 |

**深度分析(给 A/B 任务的预判)**:
- **关键洞察**:Nekosora 有 store 层 rAF 合批(每帧 content 只变一次)。高速到达时一帧内来多个 token,streamdown 的「逐字 fadeIn」在一帧多字时视觉上早已不是「一个一个冒出」,而是「一小段一小段淡入」。**逐字动画的边际视觉收益被合批稀释,但重渲染成本没稀释**。
- DEEIX 无自建合批(用 streamdown 默认节流),对动画成本更敏感,故直接关闭。
- **预判结论**:
  1. 若 FPS 实测掉帧明显 → 优先试**调大 stagger 或降级 `sep:"word"`**,而非直接 false。
  2. 若仍要关 → **必须同步升级 caret**:block 是静态方块,关动画后流式感很弱,参考 DEEIX 用持续脉冲的 circle。
  3. DEEIX 的「关」**不可直接照搬**:它配宽幅 + 大行高 + circle,Nekosora 是 75ch + block,场景不同,以本任务实测为准。

---

## 7. 主题 / 字体 / 安全

| 维度 | Nekosora | DEEIX-Chat |
|---|---|---|
| 主题 | 1 套(明/`.dark`)+ DB 皮肤(rs-paper 纸面杂志) | 8 套(azure/cobalt/graphite/lagoon/ink/ochre/sepia + 默认),各重定义配色/圆角/投影/字体 |
| 默认调性 | 暮色微澜黑/星云纯白,冷调(hue 250) | 暖灰/赭石,橙赭 primary(hue 39°) |
| 字号/字重可调 | 否 | data-font-size small/med/large(0.88/1.12/1.24)+ 字重 400-700 |
| 投影 | 克制(静止无投影,仅代码块 0.04 微投影) | 默认弱,graphite 零投影,lagoon 最重 |
| 字体加载 | 系统栈 | next/font(Geist 等) |
| 链接安全 | 普通下划线 | 外链弹确认 Dialog,linkSafety 可配 |
| HTML style 安全 | rehype-harden + ALLOWED_HTML_TAGS + streamdown-html 过滤 | sanitize 扩展 + sanitizeHTMLStyle + 纯黑白→token 映射 |

**深度分析**:
- 坚持 Nekosora 单品牌冷调(产品定位)。字号可调可作 a11y 取经(中优先)。
- 字体:系统栈跨设备不一致,引入一个 next/font 无衬线(Geist/Inter)可统一观感且首屏不阻塞(中优先,看品牌诉求)。
- 安全:DEEIX 的「纯黑白→token 映射」防 AI 输出纯黑文字在暗色下不可见,**待验证 Nekosora 是否已做**,未做则值得补。

---

## 8. 取经 / 坚持优先级总表

| 优先级 | 事项 | 类型 | 成本 |
|---|---|---|---|
| P0 | 流式动画 A/B 验证(本任务) | 决策 | 已规划 |
| P0 | 16 行代码折叠 + 渐隐遮罩 | 取经 DEEIX | 低(纯前端) |
| P1 | 字号可调(1-2 档,a11y) | 取经 DEEIX | 低 |
| P1 | 裸链接归一化(⚠️先验证现状) | 取经 DEEIX | 低 |
| P1 | 纯黑白→token 映射(⚠️先验证) | 取经 DEEIX | 低 |
| P2 | 图片 hover/Dialog(若有图片场景) | 取经 DEEIX | 中 |
| P2 | 货币防误判数学(⚠️先验证) | 取经 DEEIX | 低 |
| P2 | 引入 next/font 统一字体 | 取经 DEEIX | 中 |
| 坚持 | 75ch 窄列 / 无气泡纯文字 | — | — |
| 坚持 | 自写排版基线(品牌一致) | — | — |
| 坚持 | 结构化图表块(护城河,可加 fullscreen) | — | — |
| 坚持 | 单品牌冷调(不学多主题) | — | — |

---

## 9. ⚠️ 待验证清单(落地前用真实 AI 输出跑一遍,勿把推断当事实)

- [ ] Nekosora 是否自动把裸 URL 渲染成可点链接(streamdown 默认行为)。若不会 → 移植 `normalizeBareURL`。
- [ ] Nekosora KaTeX 是否用单 `$` 行内数学 → `$100`/`价格 $50` 是否被误吃成公式。若会 → 移植 `normalizeCurrencyDollars`。
- [ ] AI 输出带样式 HTML 时,块内空行是否导致 markdown 重新解析打断布局。
- [ ] Nekosora `streamdown-html` 是否已做纯黑白→token 映射(防暗色下纯黑文字消失)。
- [ ] 流式动画 A/B 的 on/off FPS 数据(本任务产出)。

---

## 10. 可沉淀为 spec 的契约点(供日后 trellis-update-spec 提取)

以下是从对比中提炼、未来写 markdown 渲染代码应遵守、且 spec 暂未明确收录的点(待真正落地取经时再正式进 `spec/frontend`):

1. **markdown 排版基线集中维护**:正文排版样式统一在 `src/app/globals.css` 的 `.nekusora-md` 作用域;基线特异性 (0,2,0) 必须低于输出样式皮肤 `.rs-xxx .nekusora-md`(0,3,1),以保证皮肤能覆盖基线。新增排版规则前先确认 cascade。
2. **streamdown 默认样式失效原因**:streamdown 默认依赖 Tailwind v4 的 `--border/--sidebar/--background` 等变量,本项目未定义,故默认外壳样式失效——任何依赖 streamdown 默认外观的假设都不成立,必须自行在 globals.css 显式定义。
3. **结构化块颜色策略**:chart/metric/table/callout 颜色一律前端按品牌调色板(`--color-chart-1~5`)分配,zod schema 不收 AI 色值(防 prompt 注入污染)。已部分见 `structured-blocks.md`,可补充「色值不入 schema」这条强约束。
4. **流式动画与合批的耦合**:逐字 fadeIn 动画成本不随 store rAF 合批稀释,评估动画策略时必须把「每帧 content 全量重解析」计入开销,不能假设 token 是逐个到达。
