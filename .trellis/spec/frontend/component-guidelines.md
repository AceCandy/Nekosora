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
- 暗色模式:`dark:` 前缀;依赖 `prefers-color-scheme`。
- 布局:三栏(侧栏 + 主区)用 flex;对话区 `max-w-3xl mx-auto`。
- 状态色:`text-green-600`(启用)、`text-red-600`(危险)、`text-neutral-400`(占位)。

## Streaming UI 关键

- SSE 流式:用 `fetch` + `ReadableStream` reader 手动解析 `data: {...}\n\n` 帧。
- 增量更新:`setMessages((m) => { copy[idx].content += delta; return copy; })`。
- 事件类型:`delta`(文本增量)、`finish`(含 usage)、`error`、`rag_search`、`compact`、`trace`。

## Common Mistakes

- **不要在 Client Component 直接 import server action** —— 用 `import { action } from "./actions"`(next 自动处理)。
- **不要在 Server Component 用 useState** —— 加 `"use client"` 或拆成子组件。
- **DB 行类型是 `Record<string, unknown>`** —— 渲染时用 `as string` 断言,不要直接插值 `unknown`。
- **分支列表渲染用 `String(x)` 包裹** —— 避免 `unknown` 不能作为 ReactNode 的类型错误。
