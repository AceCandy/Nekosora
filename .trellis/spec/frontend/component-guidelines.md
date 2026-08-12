# Component Guidelines

> Nekusora 前端组件约定。Next.js 16 App Router + React 19 + TailwindCSS v4。

---

## Overview

- Server Components(默认):数据获取、鉴权、静态渲染。用 `async function` 直接 await。
- Client Components:交互/状态。文件顶部 `"use client"`。
- Server Actions:表单提交用 `action={async (formData) => { "use server"; ... }}`。
- UI 基础:TailwindCSS v4(utility-first),暂未用 shadcn/ui(原生 + lucide-react 图标)。

## Component Structure

- Server Component 页面:`page.tsx` → 调 `actions.ts` 取数 → 渲染表格/表单。
- Client Component(如 `ChatComposer.tsx`):`"use client"` → useState/useRef → fetch SSE → 渲染。
- 表格列表:Server Component 查库 → `.map()` 渲染行;操作用 `<form action={serverAction.bind(null, id)}>`。

## 管理页二级 Tab（同域整合）

多个同域管理页合并进一个设置页时,用二级 tab 而非各自独立路由:

- tab 切换走 URL `?tab=<id>` + 纯 `<Link>`(无 `"use client"`,服务端按 tab 重新取数渲染),与 `UsageTabs` / `SettingsTabs` 一致。`prefetch={false}` 避免预取带参 URL。
- 每个 tab 的数据获取 + server action 集中在独立 async server component(`XxxSection.tsx`),容器 `page.tsx` 只按 `tab` 渲染对应 section——只查当前 tab 数据。
- server action 的 `revalidatePath` 指向容器页(如 `/admin/settings`),不是原独立路由。
- tab 样式:无侧边彩色粗条、无 Eyebrow、静止无投影(遵守 DESIGN)。

## 侧边栏收起(chat + dash 后台)

聊天侧(`features/chat/components/Sidebar.tsx`)与后台侧(`shared/components/DashSidebar.tsx` + `AppShell.tsx`)都支持桌面端收起侧边栏,交互一致:

- **收起状态是 client 组件内 `useState`,会话内有效、不持久化**(刷新重置为展开)。后台 `AppShell` 是 server component,收起交互下沉到 client 子组件 `DashSidebar`;登出仍走 server action,由 `AppShell` 模块级定义后透传给 `DashSidebar`,不在 client 侧另写一套。
- **桌面宽度**:chat 与 dash 都是收起态 `md:w-14`、展开态 `md:w-60`,用 `transition-[width,min-width,max-width,transform] duration-250` 过渡;内边距随状态立即切换,折叠按钮 `PanelLeftClose`/`PanelLeftOpen` 仅桌面显示(`hidden md:inline-flex`)。
- **移动端统一使用抽屉**:默认关闭,由 `md:hidden` 顶栏菜单按钮打开;侧栏固定覆盖在正文上方,支持关闭按钮、遮罩、`Escape` 与导航后关闭。打开时锁定 body 滚动、将背景顶栏/正文设为 `inert` + `aria-hidden` 并把焦点限制在抽屉内,关闭后焦点返回菜单按钮;关闭态侧栏本身也必须 `inert` + `aria-hidden`,避免离屏导航进入 Tab 顺序。移动端打开后台抽屉时重置桌面 `collapsed`,保证完整标签可见。
- **移动端几何与入口样式也必须一致**:chat 与 dash 都使用 `h-14` 顶栏和无独立边框的 `h-11 w-11` 菜单按钮,禁止退回覆盖正文的悬浮小按钮;抽屉统一为 `w-[min(18rem,calc(100vw-3rem))] max-w-72 p-4`,并使用 `transition-transform duration-200 ease-out`。所谓「统一抽屉」必须同时核对宽度、顶栏/开关按钮与动效,不能只对齐 transition 参数。
- **断点类必须互斥**:桌面展开/收起宽度不能同时把 `md:w-60` 写在基础类、再条件追加 `md:w-14`;Tailwind 同断点工具类可能仍由 `w-60` 覆盖。应使用 `collapsed ? "md:w-14 ..." : "md:w-60 ..."`。移动端菜单与关闭按钮固定 `h-11 w-11`(`44×44px`),不能只依赖 coarse-pointer 兜底。
- **导航项必须有 `icon`**(`shared/nav-config.ts` 的 `NavItem.icon: LucideIcon`):收起态 `SidebarNav` 仅渲染图标,label 与 hotkey 隐藏,靠 `title`/`aria-label` 提供 tooltip。**新增 nav 项漏配 icon 会导致收起态空图标**。
- **底部统一为用户菜单**:展开/收起态都只显示用户头像入口;点击后展示 `footerLinks`(如回到聊天)、`LanguageSwitcher` 与登出。展开态菜单向上弹出,收起态向侧栏右侧弹出。侧栏自身保持桌面 `z-40` 且不设置 `overflow-y-auto`,滚动只放在上方导航容器,否则收起态菜单会被正文覆盖或被侧栏裁剪。

## Props Conventions

- 显式 interface 定义 props,不用 inline 类型。
- Server→Client 传递的数据必须是可序列化的(避免传 Date/函数)。
- DB 行在传给 Client 前转成简单对象(role/content 字符串)。

## Styling Patterns

- Tailwind utility class,内联在 JSX className。
- 暗色模式:`dark:` 前缀 + `@custom-variant dark`(`globals.css` 已注册),由 `prefers-color-scheme` 触发。
- 布局:三栏(侧栏 + 主区)用 flex;对话区 `max-w-3xl mx-auto`。
- 状态色:`text-green-600`(启用)、`text-red-600`(危险)、`text-neutral-400`(占位)。

### 语义字号

产品 UI 字号统一使用 `globals.css` `@theme` 注册的语义工具类：

| Class | 字号 / 行高 | 用途 |
|-------|-------------|------|
| `text-ui-micro` | `11px / 16px` | 时间戳、代码标识、极次要元信息 |
| `text-ui-caption` | `12px / 16px` | 标签、小号按钮、附件和次要说明 |
| `text-ui-body` | `14px / 20px` | 后台正文、表单、菜单和常规说明 |
| `text-ui-reading` | `16px / 24px` | Chat 正文、输入框和连续阅读内容 |
| `text-ui-title` | `18px / 28px` | Modal、配置组和局部标题 |
| `text-ui-subheading` | `20px / 28px` | 页面标题和重要分区标题 |
| `text-ui-heading` | `24px / 32px` | 大组标题 |
| `text-ui-display` | `30px / 36px` | 品牌首提和展示标题 |

- 禁止新增 `text-[Npx]` 任意字号，也不要直接使用 `text-xs` / `text-sm` / `text-base` 表达产品语义。
- `text-ui-micro` 不得用于正文、表单标签或主要操作；可阅读、可操作信息至少使用 `text-ui-caption`。
- Chat 连续正文使用 `text-ui-reading leading-7`；管理后台默认使用 `text-ui-body`，不要为了“统一”牺牲数据密度。
- Recharts、语法高亮器等只接受 `fontSize` 属性的第三方边界，使用组件内具名常量，并与语义档位数值对齐；不要散落 `9/10/11px` 字面量。

### 设计 Token(品牌色)

颜色一律用 `src/app/globals.css` `@theme` 注册的语义名,严禁裸 hex / `gray-500` 这类非品牌色:

| Token | 用途 |
|-------|------|
| `sora-blue` / `sora-blue-hover` | 主操作色(主按钮) |
| `nebula-white` | 亮色背景 |
| `twilight-obsidian` / `space-ink` | 暗色背景 / 正文 |
| `nebula-silver` / `morning-mist` / `deep-space` | 次级文字 / 边框 / 分割 |
| `neku-amber` | 点缀 |

详见根目录 `DESIGN.md` 的设计主线「星枢天流」。

## 无障碍、主题与自适应交互契约

### 键盘焦点

- 共享交互原语必须显式提供 `focus-visible` 状态，不能只写 `outline-none`。
- `globals.css` 为没有显式 `focus-visible:ring` 的原生 `a/button/input/select/textarea/summary` 提供 2px `sora-blue` outline 兜底；新增组件不要覆盖或移除该兜底，除非同时提供对比度不低于 3:1 的替代焦点样式。
- 表单 label 必须通过 `htmlFor` / `id` 关联字段；动态错误用稳定 id + `aria-describedby`，需要即时播报时使用 `role="alert"`。

```tsx
// Wrong:视觉 label 与输入框没有程序化关联,且清掉焦点后无替代。
<label>密码</label>
<input className="outline-none" />

// Correct:稳定关联 + 可见焦点 + 错误说明。
<label htmlFor="password">密码</label>
<Input id="password" aria-describedby={error ? "password-error" : undefined} />
```

浏览器检查必须使用键盘 Tab 使元素命中 `:focus-visible`，并检查截图或实际 ring/outline 颜色；仅搜索 class 名不能证明焦点可见。

### 当前固定亮色主题

产品当前暂时只支持亮色主题。`RootLayout` 在首屏主动移除 `<html>.dark` 是预期行为，用于清除浏览器或旧版本遗留状态；不得仅因为仓库仍保留 `dark:` class 和暗色 token，就把它判定为主题功能回归或重新接入系统主题。

```ts
// 当前产品契约：页面始终以亮色主题启动。
document.documentElement.classList.remove("dark");
```

- `viewport.themeColor` 当前只需声明亮色值。
- 已有 `dark:` 样式和暗色 token 可以保留，暂不要求清理；新增界面必须先保证亮色语义完整，不能依赖暗色分支才能正确显示。
- 未经明确产品决策，不得恢复 `matchMedia("(prefers-color-scheme: dark)")`、主题切换入口或暗色持久化。
- 将来若恢复暗色主题，应作为独立任务同步 `RootLayout`、`viewport.themeColor`、设计 token 和浏览器回归；验证至少覆盖首次加载、系统主题变化和持久化状态。

### Reduced motion 与过渡范围

- `globals.css` 的 `prefers-reduced-motion: reduce` 是全局兜底：动画/过渡降为 `0.01ms`、迭代一次、关闭 smooth scrolling。
- 组件可以额外使用 `motion-reduce:*`，但不得删除全局兜底。
- 禁止 `transition-all`；按实际状态变化使用 `transition-colors`、`transition-opacity`、`transition-transform` 或明确的 `transition-[...]` 属性列表。

### 触屏目标

需要保持桌面紧凑密度、但在触屏上达到 44px 的控件使用 `touch-target`。`globals.css` 只在 `(pointer: coarse)` 下设置 `min-width/min-height: 44px`。

- 共享 `Button` / `Input` / `Select` / `Pagination` 默认接入。
- 直接实现的图标按钮、侧栏入口和紧凑菜单项必须显式添加 `touch-target`。
- 不要直接把所有桌面控件永久放大到 44px；用输入能力媒体查询适配。

浏览器验证至少覆盖 320/390/768/1280px 无横向溢出，并在 coarse-pointer 仿真中检查 `getBoundingClientRect()` 不小于 44px。

## UI 原语约定(`shared/ui/`)

- **样式拼接用 `clsx`**,不引入 `cva` / `tailwind-merge`。变体用联合字符串字面量 + `&&` 短路:
  ```tsx
  className={clsx(
    "inline-flex items-center ...",               // base
    variant === "primary" && "bg-sora-blue ...",   // variant
    size === "sm" && "px-2.5 py-1.5 text-xs",      // size
    className,                                      // 调用方覆盖
  )}
  ```
- **可持引用的组件用 `forwardRef` + `displayName`**(见 `Button.tsx`)。
- **受控浮层**(`Popover`/`OptionPicker`/`Modal`):`open` / `onClose` 由调用方持有,组件本身不存显隐状态;触发器作为 `children` 或 `trigger` 传入。单选/多选用 `mode: "single" | "multi"` 区分。
- 组件首行 `"use client"`;props 用具名 `interface`,导出供调用方复用。

## Streaming UI 关键

- **流式状态驻留全局 zustand store**(`chatStreamStore`),不在组件本地 state;多会话用 `runtimes: Record<conversationId, Runtime>` 隔离,切路由不断流(详见 state-management)。
- **SSE 解析**:`fetch` + `ReadableStream` reader,帧解析逻辑抽到 `features/chat/model/sse.ts`(`consumeChatSSE` / `handleStreamError`),组件不直接拼帧。
- **增量更新**:store 内按 conversationId 找到目标消息,对副本 `content += delta` 后整体替换 `runtimes`,配 `AbortController` 支持中断。
- **事件类型**:`delta`(文本增量)、`finish`(含 usage)、`error`、`rag_search`、`compact`、`trace`。
- **消息列表滚动用 `@shadcn/react/message-scroller` 原语,不虚拟滚动、不手写控制器**(`features/chat/components/ChatMessageList.tsx`):
  - chat 消息数有限(几十~几百),普通 `messages.map` 渲染无压力;**不要用 `@tanstack/react-virtual` 虚拟滚动**——其 absolute 子项 + `getTotalSize` 异步测量会破坏 flex 居中 / `scrollHeight` 实时性 / scrollAnchor,引入难调的滚动竞态(曾因此导致「新消息中上部定位」「流式跟随」双双失效)。
  - 滚动行为全部由原语承载:`<Provider autoScroll>`(流式跟随)、`<Item scrollAnchor={role==="user"}>` + `defaultScrollPosition`(user 消息锚定中上部)、`useMessageScrollerVisibility`(大纲高亮)、`useMessageScroller().scrollToMessage`(大纲跳转)、`<Button>`(回到底部)。业务层**不手写** `scrollTop=scrollHeight` / `scrollBy` 控制器(手写在异步测量下必竞态)。`useMessageScroller*` hooks 须在 `Provider` 内的子组件调用(如大纲),Provider 渲染者自身不能调。
  - **会话滚动记忆不得通过关闭 `autoScroll` 实现**:记忆同时保存 `{ scrollTop, atEnd }`,且 `atEnd` 必须使用与 Provider 相同的 `scrollEdgeThreshold`;返回底部会话时跟随当前末尾,不恢复可能过期的像素值;仅返回历史中段时,由 Provider 内子组件先调用 `scrollToStart({ behavior: "auto" })` 清除锚定并进入 `free-scrolling`,再恢复保存的 `scrollTop`。禁止在 DOM 增高后用 `scrollTop + clientHeight >= scrollHeight - threshold` 推断是否继续 following——内容增长本身会改变该距离,被误判成用户上滑。新会话 `undefined -> 真实 id` 回填时保留已建立的 user anchor,不强制到底。
  - **重新生成(regenerate)与编辑重发(editAndResend)都不触发 scrollAnchor**(目标 user 早被原语标记为「已处理锚点」;前者原地替换 assistant、后者截断到 user 后追加空 assistant):在 `ChatMessageList` 用 `ScrollAnchor` 子组件(渲染在 Provider 内)补——`handleRegenerate`/`handleEdit` 记目标 user domId(带 nonce),该轮 assistant 变为空占位后 `scrollToMessage(align:"start", scrollMargin:64)` 锚定 user 中上部;并附一条独立的「到底跟随」规则:`ResizeObserver` 监听该 user 下方 assistant,一旦其高度撑满 user 下方可见空间即 `scrollToEnd` 转 following,由原语 autoScroll 接管后续流式跟随。所有滚动走原语方法(无 effect 内 setState)。**不要用 key 重挂复刻新增路径**——原语 `Ne` 从 content 头部找首个未处理 anchor,会锚定到 msg-0 而非目标;`scrollToMessage` 则精准但走 `settling-jump` 模式(reanchor 不认,流式不自动跟随),故需上面两条配合。

## Markdown 渲染

AI 回复正文由 `shared/components/markdown/Markdown.tsx` 渲染,两条互斥路径,改动前先确认落在哪条:

- **streamdown**(默认 + 流式中):`<Streamdown>` 封装,内置 GFM/KaTeX/Mermaid/Shiki 高亮与 rehype-harden 防 XSS。流式时 `mode="streaming"` 对未闭合块容错。
- **custom**(静态 + 选中「输出样式」时):流式结束后用 `customRenderer.ts` 的 `parseMarkdown` 重渲,原样保留 AI 的 HTML/class/style(不过滤),支持 `.takeaway`/`.card-grid` 等高级组件 class。

**可执行契约(改 `parseMarkdown` 必须维持)**:

- 默认/流式 Streamdown 路径必须先调用 `normalizeHtmlBlockBlankLines`:CommonMark 会在空行结束 `<div>` 等 raw HTML block,使后续缩进标签退化为代码块。规范化只在可承载块内容的 HTML 容器内用不可见注释占住空行,不得改写代码围栏、容器外 Markdown 或 custom 最终渲染；深度扫描必须忽略 HTML 注释、属性字符串和 raw-text 标签中的伪标签。对应回归测试位于 `Markdown.test.ts` 与 `customRenderer.test.ts`。
- HTML 容器块(`htmlBlockDepth > 0`)内的所有行原样透传,**不参与 markdown 解析**——裸文字不得被包成 `<p>`,否则会被输出样式(如纸面杂志 `.rs-paper .nekusora-md p { color }`)改写颜色与边距。
- 块深度由 `countHtmlDelta` 统计;void 标签(`br`/`hr`/`img`/...)与显式自闭合、同行开闭(`<div>x</div>`)不计入深度。
- 代码块(` ``` `)优先级高于 HTML 块判定。
- `separateBareUrlTrailingText` 同时服务 streamdown/custom:裸 URL 紧跟中文时须切断链接;外层半角/全角右括号必须留在 `<a>` 外,URL 内部成对 ASCII 括号必须保留在链接内。
- 裸 HTTP(S) 图片 URL 的提升发生在两条渲染路径之前:明确图片扩展名立即提升,无扩展名仅在流式结束后经登录态 `mode=probe` 确认为栅格图片再提升。代码围栏、缩进代码、HTML 和显式 Markdown 链接中的 URL 不得转换。
- Streamdown 链接安全确认保持启用,但 `renderModal` 必须用 `createPortal(..., document.body)` 脱离 Markdown 段落;禁止把含块元素的确认层作为链接的内联兄弟节点,否则会形成 `<p><div>` 非法嵌套并触发 hydration 错误。
- 外链 hover/focus 预览由 Markdown 根层事件委托和 Portal 浮层统一承载,streamdown/custom 都只在链接上提供预览 URL 标记;点击行为继续交给原安全确认,预览图片必须走登录态 `mode=image` 代理。
- `requestLinkPreview` 只缓存成功结果;非 2xx、解析失败或网络错误必须移除缓存项,允许下一次 hover/probe 重试,不能把瞬时失败固化到页面生命周期。
- 改 `parseMarkdown` 必须跑 `src/shared/components/markdown/customRenderer.test.ts`;该测试守住「HTML 块内文字不被打散」与「普通 markdown 回归」。

**内联 style 过滤**:`streamdown-html.tsx` 对放行标签调 `sanitizeHTMLStyle`;当前仅把纯黑/纯白颜色映射为 `currentColor`,其余 style 原样透传(不做属性白名单或危险值拦截),安全兜底依赖 streamdown 内部 rehype-harden。`custom` 路径完全不过滤。

### 受信输出样式与 Artifact 隔离

#### 1. Scope / Trigger

修改输出样式的 Server→Client 投影、custom renderer 提醒或 HTML/SVG artifact 预览时适用。管理员配置与模型生成 artifact 是两条不同信任边界,不得混用同一“已净化”结论。

#### 2. Signatures

```ts
interface RenderStyle {
  renderer: "streamdown" | "custom";
}

function HtmlPreviewFrame(props: { html: string }): React.ReactNode;
```

#### 3. Contracts

- `renderer` 是输出样式 DTO 的既有字段,管理端 Server Component 传给 Client Component 时不得丢弃。`renderer="custom"` 的列表项持续显示高信任标识,编辑表单就地显示 `role="note"` 的非阻断提醒;不得增加确认勾选、保存拦截或另一套 renderer 判断。
- 管理员 CSS 原样应用于聊天页和公开分享,配置提示同时说明这两个影响面。CSS 语法、选择器和外连依靠管理员人工管控,不在 UI 层伪造 sanitizer 或启发式规则扫描。
- custom renderer 原样保留模型 HTML/class/style,脚本或事件属性仍可能在聊天页与公开分享页的应用源执行。这是管理员主动启用后被接受的剩余风险,不是 Streamdown 的净化能力。
- 模型 fenced block 生成的 HTML/SVG artifact 不属于管理员预审边界,统一通过 `HtmlPreviewFrame` 的 CSP 与 `sandbox="allow-scripts"` 预览,禁止加入 `allow-same-origin`。预览不得提供 Blob/新窗口等脱离 sandbox 的执行入口;复制与下载保留为用户主动操作。

#### 4. Validation / Error Matrix

| 输入/状态 | 行为 |
|---|---|
| `renderer="streamdown"` | 不显示 custom 风险提醒,沿用 Streamdown 防护 |
| `renderer="custom"` | 显示提醒但保存、启停不受阻断 |
| HTML/SVG artifact | 在 opaque-origin sandbox iframe 中预览 |
| 非 HTML/SVG artifact | 沿用对应受控组件或源码渲染 |

#### 5. Good / Base / Bad Cases

- Good:custom 样式显示标识和编辑提醒,管理员确认来源可控后保存。
- Base:普通新建样式沿用数据库默认 `streamdown`,不展示额外确认流程。
- Bad:将 SVG 写入主 DOM,或把 iframe 内容转成顶层 Blob 文档执行。

#### 6. Tests Required

- 管理列表断言 custom 有标识、streamdown 无标识;编辑表单断言 custom 有 `role="note"` 且提交按钮仍存在。
- HTML/SVG 两条 artifact 分支断言均渲染 iframe,sandbox 包含 `allow-scripts` 且不含 `allow-same-origin`。
- 预览断言不再暴露外部打开入口,复制与下载控件仍存在;中英文提醒 key 同步。

#### 7. Wrong vs Correct

```tsx
// Wrong:模型 SVG 直接进入应用主 DOM。
<div dangerouslySetInnerHTML={{ __html: artifact.content }} />

// Correct:模型 HTML/SVG 共用 opaque-origin sandbox。
<HtmlPreviewFrame html={artifact.content} />
```

### Streamdown 富媒体交互契约

- Markdown 图片只在 streamdown 路径通过 `components.img = MarkdownImage` 增强;必须保留懒加载、加载骨架、失败占位、原图下载和 Modal 放大。`alt` 同时是无障碍文本与失败兜底文案。custom 输出样式仍由 `customRenderer.ts` 原样渲染,不要假设两条路径自动共享 React 组件。
- 所有由 Markdown 语法或裸图片 URL 生成的远程 `http(s)` 图片都必须经 `getProxiedMarkdownImageUrl` 转为登录态 `/api/link-preview?mode=image` 地址;正文 `<img>`、Modal 与下载链接使用同一代理 URL。custom 的 `inlineMarkdown` 也必须调用该 helper,否则列表内图片会绕开 `MarkdownImage` 并重新触发外站防盗链。原样透传的手写 HTML 不属于该转换边界。
- 图片加载地址与复制地址必须分离:正文、Modal 和下载使用代理 URL,「复制图片链接」始终复制原始 URL。Streamdown 由 `MarkdownImagePreviewModal` 承载大图与复制;custom 的静态 `<img>` 必须写入经属性转义的 `data-markdown-image-url=<原始 URL>`、`role="button"` 和 `tabindex="0"`,再由 `CustomMarkdownSegment` 的 click/Enter/Space 事件委托打开同一 Portal 弹窗。列表图片不得为获得交互而从 `parseMarkdown` 单独拆出,否则会重置有序列表编号。
- 附件图片与 Markdown 图片的大图预览必须复用 `shared/components/file-preview/ImagePreviewModal`:附件调用方传 `/api/files/{fileId}`,Markdown 调用方传登录态图片代理 URL,复制原始 URL 和下载代理图片等业务操作通过 `toolbar` 留在 Markdown 调用方。不要给 `FilePreviewModal` 增加外链 URL 联合入参,也不要在 Markdown 层另建带标题栏的图片弹窗,否则会让同一图片交互出现两套视觉和 URL 语义。
- `MarkdownImage` 可能被 Streamdown 放进 `<p>`，其就地 DOM 必须全部是 phrasing content（例如 `<span>`）；禁止返回 `<figure>` 或 `<div>`。放大 Modal 必须 Portal 到 `document.body`，否则会产生非法段落嵌套和 hydration error。
- Mermaid 仅在图形模式显示全屏入口;源码模式不显示。全屏视图复用 `MermaidDiagram`,但必须传独立 `id`,避免内联图与全屏图的 `mermaid.render` DOM 标识冲突。查看器 Modal 必须 Portal 到 `document.body`,避免输出样式的 `.nekusora-md h1/h2` 规则污染查看器标题。关闭 Modal 时重置缩放和平移;缩放范围固定为 `0.3-5`。
- Mermaid 正文实例必须给 SVG `width:100%; height:auto` 并使用正文限高滚动容器；这些 class 只由内联块传入，共享的 Artifact 与全屏实例不得继承正文尺寸语义。
- `@streamdown/code` 的 Shiki 运行时必须在项目根 `package.json` 保持直接依赖,版本与插件解析出的版本一致。仅依赖传递依赖会让 Next.js `serverExternalPackages` 无法从项目根解析 `shiki` / `shiki/wasm`,开发服务器会持续输出 `Package shiki can't be external`。

### Streamdown 代码块几何契约

关闭行号后,Shiki 输出的行节点需要 `code > span { display: block }` 保留换行。此时外层 `code` 也必须是块级元素;如果保持默认 `inline`,其块级子节点不会被 `code` 的左内边距推开,即使 computed style 显示 padding 已生效,代码文字仍会贴住正文块左缘。

长代码块的 16 行折叠门槛只在流式结束后生效。`isStreaming=true` 时不得应用 `max-height` / `overflow-hidden`、渐隐遮罩或折叠按钮,代码必须随增量完整展示;切换为 `false` 后,超过门槛的代码块才进入默认折叠态。手动展开状态应绑定当前代码内容,避免续写或重新生成沿用旧内容的展开状态。该边界由 `shouldCollapseCodeBlock(lineCount, isStreaming)` 统一判断,单测至少覆盖 16/17 行和 streaming/static 两种状态。

```css
/* Wrong: inline code 的 padding 无法约束块级行节点。 */
.nekusora-md [data-streamdown="code-block-body"] code > span { display: block; }
.nekusora-md [data-streamdown="code-block-body"] code { padding-left: 1.5rem; }

/* Correct:header 与 code 使用同一内边距,并清掉标签的默认 margin。 */
.nekusora-md [data-streamdown="code-block-header"] { padding-left: 1.5rem; }
.nekusora-md [data-streamdown="code-block-header"] span { margin-left: 0; }
.nekusora-md [data-streamdown="code-block-body"] code {
  display: block;
  padding-left: 1.5rem;
}
```

浏览器回归检查必须直接比较文字节点,不能用“容器 left + padding”推算:

```typescript
expect(codeText.getBoundingClientRect().left - headerText.getBoundingClientRect().left).toBe(0);
```

至少覆盖桌面与窄屏;长代码允许在 `pre` 内横向滚动,但代码块本身不得撑出视口。

## Interaction Gotchas

非显而易见的交互行为坑,踩过一次就要记住:

### Hover 触发容器的「贴边陷阱」

**症状**:浮层在鼠标进入一大片「看起来是空白」的区域时就提前弹出。

**原因**:为了让浮层好定位,常把触发容器写成撑满父级高度的绝对定位:
```tsx
// Bad: 容器覆盖整列高度,横条上下方的空白都会触发 onmouseenter
<div className="absolute top-0 right-0 bottom-0" onMouseEnter={...}>
  <nav>横条列</nav>
  {hovered && <浮层 />}
</div>
```

**解法**:触发容器只包住真正可交互的元素,不要用 `top-0 bottom-0` 借高度:
```tsx
// Good: 容器与横条列同高、垂直居中,只有横条区域 hover 才触发
<div className="absolute top-1/2 right-0 -translate-y-1/2" onMouseEnter={...}>
  {hovered && <浮层 />}
  <nav>横条列</nav>
</div>
```

适用 `ChatOutline` 这类「贴边小触发器 + 弹出浮层」的结构。

**手机无 hover**:触屏上 `onMouseEnter` 不生效,贴边大纲改用 scrub -- 容器加 `touch-action:none`(Tailwind `touch-none`)接管手势不滚页面,`onTouchStart/Move` 据触摸 Y 映射到轮次索引高亮预览(用 ref 同步供 `onTouchEnd` 即时读,state 异步可能未提交),`onTouchEnd` 放手 `scrollToMessage` 跳转;桌面 hover 浮层列表行为保留。

### 浮层被祖先 overflow 裁剪

**症状**:`Popover`/`OptionPicker` 等浮层在表格(`overflow-auto`)、弹窗(`max-h`)等可滚动容器内被裁剪,超出容器边缘的部分看不到;`max-h-[calc(100vh-...)]` 估值不准时也会被截。

**原因**:面板用 `position: absolute`,相对最近的 positioned 祖先定位,会被该祖先的 `overflow` 裁剪--任何中间层 `overflow-auto/hidden` 都吃掉溢出部分。

**解法**:浮层面板改 `position: fixed`(相对视口,不被任何祖先 overflow 裁剪),位置由 `useLayoutEffect` 依据触发器 `getBoundingClientRect()` 命令式计算,直接写 `panel.style.left/top`(不 `setState`,避免 `react-hooks/set-state-in-effect` 告警与级联重渲染),并 clamp 到视口内 8px 边距:
```tsx
useLayoutEffect(() => {
  if (!open) return;
  const wrapper = wrapperRef.current, panel = panelRef.current;
  if (!wrapper || !panel) return;
  const compute = () => {
    const wr = wrapper.getBoundingClientRect();
    const gap = 4;
    let left = align === "right" ? wr.right - panel.offsetWidth : wr.left;
    let top = side === "bottom" ? wr.bottom + gap : wr.top - panel.offsetHeight - gap;
    left = Math.max(8, Math.min(left, window.innerWidth - panel.offsetWidth - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - panel.offsetHeight - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "visible";
  };
  panel.style.visibility = "hidden"; // 先隐藏,compute 后再显示,避免首帧闪在 (0,0)
  compute();
  const ro = new ResizeObserver(compute); ro.observe(panel);
  const onScroll = () => requestAnimationFrame(compute);
  window.addEventListener("scroll", onScroll, true); // capture:子树任意滚动都跟随
  window.addEventListener("resize", onScroll);
  return () => { ro.disconnect(); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
}, [open, align, side]);
```
- `scroll` 用 capture 阶段 + rAF 节流,触发器所在容器滚动时面板跟随重定位。
- 面板 `onClick` 阻止冒泡,避免 `clickToggle` 模式下点面板误触发关闭。
- `absolute -> fixed` 是单向升级:`shared/ui/Popover` 所有用法(模型悬浮窗、Combobox、UsageLogsTable、ChatToolbar 等)一并受益,无需各调用方改。

**fixed 的 containing block 陷阱(必读)**:`position: fixed` 不一定相对视口--祖先有 `transform`/`filter`/`backdrop-filter`/`will-change`/`perspective`/`contain: paint` 时,该祖先会成为 fixed 后代的 containing block(CSS 规范),面板实际相对该祖先定位。此时 `useLayoutEffect` 仍用视口坐标 `getBoundingClientRect()` 设 `left/top`,坐标系错位,面板会飞到视口外--表现是「点击触发器没反应」(浮层其实开了,只是看不见)。chat 输入区悬浮卡片 `composerRef` 的 `backdrop-blur-sm`(设计要求的毛玻璃,不能去)就踩过这个坑;`backdrop-filter` 与 `transform` 同类,都会劫持 fixed。

**根治:面板 `createPortal` 到 `document.body`**。面板脱离所有祖先的 containing block 与 overflow,fixed 相对视口定位,坐标系与 `getBoundingClientRect()` 一致,既不被 overflow 裁剪、也不被 backdrop-blur 等祖先劫持。比「去掉祖先 transform」或「改回 absolute」更优--前者常做不到(视觉必需)、后者会让 overflow 裁剪复发。`shared/ui/Popover` 已统一 Portal,所有调用方受益。Portal 后:
- `PopoverCloseContext` 仍跨 Portal 生效(`createPortal` 保留 React 树),面板内 `usePopoverClose()` 照常工作。
- hover 模式下面板已脱离 wrapper,需在面板自绑 `onMouseEnter/onMouseLeave`(复用 trigger 的 onEnter/onLeave),否则鼠标从 trigger 移到面板会触发 wrapper `onLeave` 收起浮层。
- `typeof document !== "undefined"` 守卫避免 SSR 时 `createPortal` 报错(面板本就由 `effectiveOpen` 控制仅在客户端打开)。
- `<dialog showModal>` top-layer 内的 fixed 面板必须保留在 dialog 内(`Popover portal={false}`);Portal 到 `document.body` 会被 top-layer 遮挡。

**click-outside 不要用「`fixed inset-0` 透明遮罩」**(除非是真正的视觉遮罩,如移动端抽屉/模态)。问题有两层:
1. containing block 陷阱:遮罩嵌在 `transform`/`backdrop-filter` 祖先内时只盖住祖先盒子,点主内容区关不掉(侧栏会话菜单踩过)。
2. 即便 Portal 到 body 盖住全屏,透明遮罩仍会整页拦截指针,体感像「还罩着一个框」,滚动/点选背后内容都被挡住。

轻量菜单统一用 `useClickOutside(ref | ref[], onOutside, enabled)`(`src/shared/lib/useClickOutside.ts`):document 级 `pointerdown`,不渲染遮罩。注意:
- ref 包住触发器 + 面板;Portal 面板可与 trigger 分属不同 ref,传数组即可(`Popover` 已如此)。
- Portal 面板根节点标 `data-popover-root`,父级 hook 会忽略其内部点击,避免子 OptionPicker 点选时父菜单被先拆掉。
- 视觉遮罩(半透明 backdrop、锁滚动)仍用 fixed 覆盖层,且须是 transform 祖先的兄弟或 Portal 到 body,不能嵌在 transform 容器内。
- `shared/ui/Popover` **不得**再渲染全屏透明 catcher;关闭只走 `useClickOutside`。

### 粘贴上传的文件类型过滤

**症状**:用户复制一段富文本/网页内容进输入框,被误当成「粘贴文件」触发上传。

**原因**:`clipboardData.items` 里富文本常带 `kind === "file"` 的 `text/*` 项(如 `text/html`、`text/rtf`),只判断 `kind === "file"` 会把它们当文件收集。

**解法**:收集粘贴文件时排除 `text/*`,只留真正的二进制文件(图片、PDF 等):
```tsx
for (const item of items) {
  if (item.kind !== "file") continue;
  const f = item.getAsFile();
  if (!f || f.type.startsWith("text/")) continue; // 关键:排除纯文本项
  files.push(f);
}
```

拖拽(`onDrop`)走 `dataTransfer.files`,不含文本项,无需同样过滤。

## Scenario: PDF 预览静态资源

### 1. Scope / Trigger

升级 `pdfjs-dist`、修改 `PreviewPdf` 或调整安装/部署流程时，必须验证 worker、CMap 和标准字体三类资源。浏览器不能直接从运行时 URL 解析 `node_modules` 包路径。

### 2. Signatures

- 安装入口：`package.json#postinstall -> node scripts/sync-pdfjs-assets.cjs`
- worker URL：`/pdfjs/pdf.worker.min.mjs`
- CMap URL：`/pdfjs/cmaps/`
- 标准字体 URL：`/pdfjs/standard_fonts/`

### 3. Contracts

- `sync-pdfjs-assets.cjs` 从当前安装的 `pdfjs-dist` 同步 1 个 worker、CMap 目录和标准字体目录到 `public/pdfjs/`。
- `PreviewPdf` 只引用同源 `/pdfjs/` URL，不依赖 CDN，也不构造 `/pdfjs-dist/...` 包路径。
- 三类资源都是第三方安装生成物，必须由 `.gitignore` 排除，不提交仓库。
- 找不到 `pdfjs-dist` 或 worker 时输出警告；安装流程沿用可选 PDF 能力的降级策略。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| worker 同步成功 | `/pdfjs/pdf.worker.min.mjs` 返回 200 JavaScript |
| worker 缺失 | postinstall 警告，PDF 预览不可用 |
| CMap/字体缺失 | PDF 可能渲染，但 CJK 或标准字体异常 |
| 组件引用 `/pdfjs-dist/...` | Next 静态服务返回 404，worker 初始化失败 |

### 5. Good / Base / Bad Cases

- Good：`pnpm install` 后三类资源均可由 Next 同源静态访问，PDF 无需外网即可渲染。
- Base：不使用 PDF 预览时，资源同步失败不影响其他聊天功能。
- Bad：仅检查 `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` 存在，却让浏览器请求 `/pdfjs-dist/build/...`；依赖已安装但运行时仍 404。

### 6. Tests Required

- 运行 `node scripts/sync-pdfjs-assets.cjs`，断言输出包含 `1 worker`。
- 用 `cmp` 校验 public worker 与当前依赖 worker 内容一致。
- 启动本地 Next 后请求 `/pdfjs/pdf.worker.min.mjs`，断言 HTTP 200、JavaScript 内容类型和非零大小；验收后关闭服务。
- 运行 lint，确保 `PreviewPdf` effect 无缺失依赖 warning。

### 7. Wrong vs Correct

```typescript
// Wrong:window.location.origin 只会生成站内 URL,不会让 Next 暴露 node_modules。
new URL("pdfjs-dist/build/pdf.worker.min.mjs", window.location.origin).href;

// Correct:postinstall 已把版本匹配的 worker 同步到 public。
pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
```

## Common Mistakes

- **不要在 Client Component 直接 import server action** —— 用 `import { action } from "./actions"`(next 自动处理)。
- **不要在 Server Component 用 useState** —— 加 `"use client"` 或拆成子组件。
- **DB 行类型是 `Record<string, unknown>`** —— 渲染时用 `as string` 断言,不要直接插值 `unknown`。
- **分支列表渲染用 `String(x)` 包裹** —— 避免 `unknown` 不能作为 ReactNode 的类型错误。
- **i18n key 必须落在 `useTranslations(namespace)` 对应的命名空间** —— `t("reasoningLow")` 解析的是 `<namespace>.reasoningLow`;同一字面量 key 在不同 namespace 要各自补齐(如 chat 与 models 各需一份 `reasoningLow`)。运行时报 `MISSING_MESSAGE: Could not resolve <ns>.<key>` 即 namespace 错位。
