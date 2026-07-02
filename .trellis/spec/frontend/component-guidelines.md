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
