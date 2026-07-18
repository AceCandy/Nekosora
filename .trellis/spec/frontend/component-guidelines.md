# Component Guidelines

> Nekusora 前端组件约定。Next.js 15 App Router + React 19 + TailwindCSS v4。

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

## Props Conventions

- 显式 interface 定义 props,不用 inline 类型。
- Server→Client 传递的数据必须是可序列化的(避免传 Date/函数)。
- DB 行在传给 Client 前转成简单对象(role/content 字符串)。

## Styling Patterns

- Tailwind utility class,内联在 JSX className。
- 暗色模式:`dark:` 前缀 + `@custom-variant dark`(`globals.css` 已注册),由 `prefers-color-scheme` 触发。
- 布局:三栏(侧栏 + 主区)用 flex;对话区 `max-w-3xl mx-auto`。
- 状态色:`text-green-600`(启用)、`text-red-600`(危险)、`text-neutral-400`(占位)。

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
  - **重新生成(regenerate)与编辑重发(editAndResend)都不触发 scrollAnchor**(目标 user 早被原语标记为「已处理锚点」;前者原地替换 assistant、后者截断到 user 后追加空 assistant):在 `ChatMessageList` 用 `ScrollAnchor` 子组件(渲染在 Provider 内)补——`handleRegenerate`/`handleEdit` 记目标 user domId(带 nonce),该轮 assistant 变为空占位后 `scrollToMessage(align:"start", scrollMargin:64)` 锚定 user 中上部;并附一条独立的「到底跟随」规则:`ResizeObserver` 监听该 user 下方 assistant,一旦其高度撑满 user 下方可见空间即 `scrollToEnd` 转 following,由原语 autoScroll 接管后续流式跟随。所有滚动走原语方法(无 effect 内 setState)。**不要用 key 重挂复刻新增路径**——原语 `Ne` 从 content 头部找首个未处理 anchor,会锚定到 msg-0 而非目标;`scrollToMessage` 则精准但走 `settling-jump` 模式(reanchor 不认,流式不自动跟随),故需上面两条配合。

## Markdown 渲染

AI 回复正文由 `shared/components/markdown/Markdown.tsx` 渲染,两条互斥路径,改动前先确认落在哪条:

- **streamdown**(默认 + 流式中):`<Streamdown>` 封装,内置 GFM/KaTeX/Mermaid/Shiki 高亮与 rehype-harden 防 XSS。流式时 `mode="streaming"` 对未闭合块容错。
- **custom**(静态 + 选中「输出样式」时):流式结束后用 `customRenderer.ts` 的 `parseMarkdown` 重渲,原样保留 AI 的 HTML/class/style(不过滤),支持 `.takeaway`/`.card-grid` 等高级组件 class。

**可执行契约(改 `parseMarkdown` 必须维持)**:

- HTML 容器块(`htmlBlockDepth > 0`)内的所有行原样透传,**不参与 markdown 解析**——裸文字不得被包成 `<p>`,否则会被输出样式(如纸面杂志 `.rs-paper .nekusora-md p { color }`)改写颜色与边距。
- 块深度由 `countHtmlDelta` 统计;void 标签(`br`/`hr`/`img`/...)与显式自闭合、同行开闭(`<div>x</div>`)不计入深度。
- 代码块(` ``` `)优先级高于 HTML 块判定。
- 改 `parseMarkdown` 必须跑 `src/shared/components/markdown/customRenderer.test.ts`;该测试守住「HTML 块内文字不被打散」与「普通 markdown 回归」。

**内联 style 过滤**:`streamdown-html.tsx` 对放行标签调 `sanitizeHTMLStyle`;当前为原样透传(不做属性白名单/危险值拦截/中性色映射),安全兜底依赖 streamdown 内部 rehype-harden。`custom` 路径完全不过滤。

### Streamdown 富媒体交互契约

- Markdown 图片只在 streamdown 路径通过 `components.img = MarkdownImage` 增强;必须保留懒加载、加载骨架、失败占位、原图下载和 Modal 放大。`alt` 同时是无障碍文本与失败兜底文案。custom 输出样式仍由 `customRenderer.ts` 原样渲染,不要假设两条路径自动共享 React 组件。
- Mermaid 仅在图形模式显示全屏入口;源码模式不显示。全屏视图复用 `MermaidDiagram`,但必须传独立 `id`,避免内联图与全屏图的 `mermaid.render` DOM 标识冲突。关闭 Modal 时重置缩放和平移;缩放范围固定为 `0.3-5`。
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

**注意**:`<dialog showModal>` top-layer 内的 fixed 面板定位正常;但祖先有 `transform`/`filter`/`will-change` 时 fixed 会相对该祖先而非视口(CSS 规范),面板错位--此时去掉祖先 transform 或改回 absolute。

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

## Common Mistakes

- **不要在 Client Component 直接 import server action** —— 用 `import { action } from "./actions"`(next 自动处理)。
- **不要在 Server Component 用 useState** —— 加 `"use client"` 或拆成子组件。
- **DB 行类型是 `Record<string, unknown>`** —— 渲染时用 `as string` 断言,不要直接插值 `unknown`。
- **分支列表渲染用 `String(x)` 包裹** —— 避免 `unknown` 不能作为 ReactNode 的类型错误。
- **i18n key 必须落在 `useTranslations(namespace)` 对应的命名空间** —— `t("reasoningLow")` 解析的是 `<namespace>.reasoningLow`;同一字面量 key 在不同 namespace 要各自补齐(如 chat 与 models 各需一份 `reasoningLow`)。运行时报 `MISSING_MESSAGE: Could not resolve <ns>.<key>` 即 namespace 错位。
