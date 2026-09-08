# Directory Structure

> Nekusora 前端代码组织约定。Next.js 16 App Router + React 19。

---

## Overview

代码按「职责分层 + 特性内聚」组织：

- `src/app/` — 路由与渲染（App Router）。
- `src/features/` — 业务特性，UI + actions + hooks + store 内聚在同一目录。
- `src/lib/` — Web 专属会话、认证客户端与少量服务适配。
- `src/shared/` — 跨特性复用的 UI、复合组件与工具。
- `packages/core/src/lib/` — 框架中立的领域服务、仓储与基础设施。

---

## Directory Layout

```
src/
├── app/                       # Next.js App Router
│   ├── (dash)/               # 管理面板路由组（登录后）
│   │   └── panel/...         # 各管理页（Server Component 查库 + 表单）
│   │   └── admin/...         # 管理员域
│   ├── chat/                 # 聊天工作台
│   │   └── [id]/page.tsx     # 单会话页（Server Component 注入初始消息）
│   ├── v1/                   # 薄兼容导出；实际数据面由 Gateway 承接
│   ├── api/                  # 内部 API（上传、文件、知识检索等）
│   ├── layout.tsx
│   └── globals.css           # Tailwind v4 + @theme 设计 token
├── features/                 # 业务特性（UI + actions + hooks + store 内聚）
│   └── chat/
│       ├── components/       # 该特性的 React 组件
│       ├── hooks/            # 该特性的自定义 hooks
│       ├── actions/          # "use server" 服务端动作
│       ├── store/            # zustand 全局 store
│       └── model/            # 类型 + SSE 解析等纯逻辑
├── lib/                      # Web 专属适配与保留在此的契约测试
│   ├── auth-client.ts        # 浏览器认证客户端
│   ├── <domain>/service.ts   # render-styles、output-modes 的 Web 适配
│   ├── settings-control/runtime.ts # 发布后失效与会话适配
│   ├── session.ts            # 服务端会话（getSession/requireSession/requireAdmin）
│   └── *.test.ts             # 纯逻辑单测（与被测文件同目录）
└── shared/
    ├── ui/                   # 通用 UI 原语（Button、Popover、Modal…）
    ├── components/            # 复合组件（AppShell、markdown、SidebarNav…）
    └── lib/                  # 跨特性工具与通用 hook（useClickOutside）
```

---

## Path Aliases

`tsconfig.json` 注册的别名（vitest 配置同步映射）：

| 别名 | 指向 | 用途 |
|------|------|------|
| `@/auth` | `packages/core/src/auth.ts` | 共享服务端认证 |
| `@/lib/*` | `packages/core/src/lib/*` | 共享领域逻辑；下述精确别名优先 |
| `@/*` | `apps/web/src/*` | 其他 Web 本地模块 |
| `@shared/*` | `src/shared/*` | 复用 UI 与工具 |
| `@features/*` | `src/features/*` | 跨特性引用 |

`@/lib/session`、`@/lib/auth-client`、`@/lib/output-modes/service`、
`@/lib/render-styles/service`、`@/lib/settings-control/runtime` 精确映射 Web
本地 `src/lib/`。表中 workspace 路径相对仓库根目录，`src/shared` 与
`src/features` 相对 `apps/web`；不要把 `@/lib/*` 一概理解为 Web 本地源码。

新增 import 时按被引用对象的归属选择前缀；同特性内部用相对路径即可。

数据库引用使用已有包导出 `@nekusora/db`、`@nekusora/db/types`、
`@nekusora/db/schema`，不配置 `@/db/*` 或直达数据库源码的消费端别名。
纯类型保持 `import type`；业务运行时通过 `getDb/getSchema` 惰性取表。
Web 的 `src/db/schema/pg.ts` 仍是 Drizzle 配置使用的迁移工具转发入口，
不作为业务导入路径。验证导入调整须覆盖 typecheck、Vitest 和应用构建。

---

## Module Organization

**新特性归入 `features/`**，内部按职责切分目录（`components/` / `hooks/` / `actions/` / `store/` / `model/`）。参考 `features/chat`。

**共享领域服务归入 `packages/core/src/lib/`**；Web 的 `src/lib/` 保留依赖 Next.js 会话或缓存失效的适配。服务端入口先鉴权，再调用领域服务，不在领域服务中引入页面渲染。

**复用已有仓储**：共享路由数据访问位于 `packages/core/src/lib/repositories/`，如 `RouteRepository`。不为单次调用预建新的抽象层。

---

## Naming Conventions

- 组件文件：`PascalCase.tsx`（`ChatComposer.tsx`、`Button.tsx`）。
- hooks：`useXxx.ts`（camelCase，如 `useChatRuntime.ts`）。
- actions / store / service：`actions.ts` / `xxxStore.ts` / `service.ts`。
- 测试：`<被测名>.test.ts` / `.test.tsx`，通常与被测文件同目录；迁移后仍保留在 Web 的兼容契约测试除外。
- 路由组用括号：`(dash)` 表示不进 URL 的分组。

---

## Examples

- 特性内聚标杆：`src/features/chat/`（components/hooks/actions/store/model 五件套）。
- 领域服务标杆：`src/lib/render-styles/service.ts`（鉴权 → 查库 → 返回 DTO）。
- 可测试数据访问标杆：`packages/core/src/lib/repositories/route-repository.ts`（接口 + Drizzle 实现）。
