# Directory Structure

> Nekusora 前端代码组织约定。Next.js 15 App Router + React 19。

---

## Overview

代码按「职责分层 + 特性内聚」组织。三层职责清晰分离：

- `src/app/` — 路由与渲染（App Router）。
- `src/features/` — 业务特性，UI + actions + hooks + store 内聚在同一目录。
- `src/lib/` — 跨特性的领域逻辑（服务、仓储、基础设施）。
- `src/shared/` — 跨特性复用的 UI 原语与纯工具。

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
│   ├── v1/                   # OpenAI 兼容网关（route handlers）
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
├── lib/                      # 跨特性领域逻辑
│   ├── infra/                # db / cache / queue / storage / env / metrics
│   ├── repositories/         # 数据访问抽象（便于单测注入 mock）
│   ├── <domain>/service.ts   # 各业务域服务（render-styles、output-modes…）
│   ├── errors.ts             # 全站错误码 + API 错误契约
│   ├── session.ts            # 服务端会话（getSession/requireSession/requireAdmin）
│   └── *.test.ts             # 纯逻辑单测（与被测文件同目录）
└── shared/
    ├── ui/                   # 通用 UI 原语（Button、Popover、Modal…）
    ├── components/            # 复合组件（AppShell、markdown、SidebarNav…）
    └── lib/                  # 跨特性纯工具
```

---

## Path Aliases

`tsconfig.json` 注册的别名（vitest 配置同步映射）：

| 别名 | 指向 | 用途 |
|------|------|------|
| `@/*` | `src/*` | 默认前缀，覆盖 `app/`、`lib/`、`db/` 等 |
| `@shared/*` | `src/shared/*` | 复用 UI 与工具 |
| `@features/*` | `src/features/*` | 跨特性引用 |

新增 import 时按被引用对象的归属选择前缀；同特性内部用相对路径即可。

---

## Module Organization

**新特性归入 `features/`**，内部按职责切分目录（`components/` / `hooks/` / `actions/` / `store/` / `model/`）。参考 `features/chat`。

**领域服务归入 `lib/<domain>/`**：每个业务域一个目录，对外暴露 `service.ts`（如 `lib/render-styles/service.ts`）。服务内做鉴权（`requireSession` / `requireAdmin`）+ DB 访问（`getDb` / `getSchema`），不写渲染。

**跨特性数据访问走 `lib/repositories/`**：当某块逻辑需要可测试性（解耦 ORM）时，抽出接口（如 `RouteRepository`）+ Drizzle 默认实现 + 测试用 mock。

---

## Naming Conventions

- 组件文件：`PascalCase.tsx`（`ChatComposer.tsx`、`Button.tsx`）。
- hooks：`useXxx.ts`（camelCase，如 `useChatRuntime.ts`）。
- actions / store / service：`actions.ts` / `xxxStore.ts` / `service.ts`。
- 测试：`<被测名>.test.ts`，与被测文件同目录。
- 路由组用括号：`(dash)` 表示不进 URL 的分组。

---

## Examples

- 特性内聚标杆：`src/features/chat/`（components/hooks/actions/store/model 五件套）。
- 领域服务标杆：`src/lib/render-styles/service.ts`（鉴权 → 查库 → 返回 DTO）。
- 可测试数据访问标杆：`src/lib/repositories/route-repository.ts`（接口 + Drizzle 实现）。
