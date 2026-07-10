# Frontend Development Guidelines

> Nekusora 前端开发规范。Next.js 15 App Router + React 19 + TailwindCSS v4 + zustand。

---

## Overview

本目录沉淀 Nekusora 前端**实际存在且稳定**的编码模式,作为 AI 助手与新人上手时的可执行契约。所有约定均来自现有代码,不预设未来架构。

技术栈要点:
- **渲染**:Server Components(默认) + Client Components(交互) + Server Actions。
- **状态**:zustand(全局客户端状态,按业务域切片),不引入 React Query / SWR。
- **样式**:Tailwind v4 utility-first,品牌色用 `globals.css` `@theme` 注册的语义 token。
- **校验**:zod(边界校验)。
- **质量门槛**:`pnpm lint` + `pnpm typecheck` + `pnpm test`(vitest)。

设计主线「星枢天流」与品牌色详见根目录 `DESIGN.md`。

---

## Pre-Development Checklist

动手前确认:
- [ ] 明确改动落在哪一层(`app/` / `features/` / `lib/` / `shared/`),路径别名选对。
- [ ] Server/Client 边界已规划(`"use client"` / `"use server"`)。
- [ ] 服务端入口会经过鉴权(`requireSession` / `requireAdmin`)。
- [ ] 颜色用设计 token,无裸 hex。
- [ ] 涉及流式 / 错误码 / 鉴权改动时,已定位对应单测。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | 三层职责 + 特性内聚 + 路径别名 | Filled |
| [Component Guidelines](./component-guidelines.md) | Server/Client 模式、props、样式 token、UI 原语、流式 UI | Filled |
| [Hook Guidelines](./hook-guidelines.md) | 运行时适配层 / 交互控制器 / 资源收集器三类 hook | Filled |
| [State Management](./state-management.md) | zustand 多实例隔离、selector 稳定引用、server state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | lint/typecheck/test 门槛、必需/禁止模式、review checklist | Filled |
| [Type Safety](./type-safety.md) | DB 行 unknown 收敛、zod 边界校验、DTO 组织 | Filled |
| [Structured Blocks](./structured-blocks.md) | chart/metric/table/callout 双链路渲染、流式渐进、降级 | Filled |
| [List Drag-Sort](./list-drag-sort.md) | 列表拖动排序:dnd-kit + useOptimistic + reorder action 模式与 async transition 坑 | Filled |

---

## Quality Check

提交前至少跑通:

```bash
pnpm check    # = lint + typecheck
pnpm test     # vitest 单测
```

改动触及以下核心契约时,必须补/更对应单测:流式解析(`stream.ts`)、错误码映射(`errors.ts`、`i18n`)、token 估算(`tokens.ts`)、路由决策(`routing.ts` 经 `repositories/`)。
