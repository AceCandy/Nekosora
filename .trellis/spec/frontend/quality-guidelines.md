# Quality Guidelines

> Nekusora 前端质量标准。

---

## Overview

质量门槛由三条命令保证：

- `pnpm lint`（next lint / eslint，含 react-hooks 规则）
- `pnpm typecheck`（tsc --noEmit）
- `pnpm test`（vitest，纯逻辑单测）

`pnpm check` = lint + typecheck。提交前至少跑通这三条。

---

## Required Patterns

- **Server / Client 边界**：交互组件文件首行 `"use client"`；服务端动作用 `"use server"`。
- **服务端数据访问**：经 `requireSession` / `requireAdmin` 鉴权后再 `getDb()` / `getSchema()`，不在组件里直接访问 DB。
- **API 错误**：网关 / API route 返回错误统一走 `apiErrorLocalized(code, req)`（见 `lib/errors.ts` 契约），HTTP status 由错误码决定。
- **i18n**：错误文案经 `lib/i18n` 按 `Accept-Language` 渲染，不硬编码中文字符串进错误响应（UI 文案另接 next-intl）。
- **设计 token**：颜色一律用 `globals.css` `@theme` 注册的语义名（`sora-blue`、`nebula-white`、`twilight-obsidian`…），不用裸 hex。

---

## Testing Requirements

- **单测范围**：纯逻辑（stream 解析、错误码映射、token 估算、路由决策）。文件 `<被测名>.test.ts` 与被测文件同目录。
- **可测试性设计**：需要 DB 的逻辑抽 `repositories/` 接口，测试注入内存 mock（见 `route-repository.test` 配套模式）。
- **vitest 配置**：`environment: node`，include `src/**/*.test.{ts,tsx}`，别名与 tsconfig 同步映射 `@` / `@shared` / `@features`。含 JSX 的组件测试使用 `.test.tsx`，与被测组件同目录。
- **浏览器权限 API**：Clipboard 等依赖用户激活的 API 必须在真实点击中调用并做浏览器验证，不能跨服务端请求等 `await` 后再自动触发；原生 `<dialog>` 内的焦点型回退元素必须挂载在当前 dialog 内。
- 组件 / 页面暂不要求测试；流式、鉴权、错误码这类核心契约优先覆盖。

---

## Forbidden Patterns

- **不要在 Server Component 里用 `useState` / 浏览器 API** → 加 `"use client"` 或拆子组件。
- **不要在 Client Component 顶部直接 import 含 `"use server"` 的动作之外还混入 server-only 依赖** → 用专门的 `actions.ts` 集中导出。
- **不要绕过 `requireSession` 直连 DB** → 所有服务端入口先鉴权。
- **不要用裸 hex / `text-gray-500` 这类非品牌色** → 用设计 token。
- **不要把测试放进 `src/**/*.test.{ts,tsx}` 之外** → 会被 vitest 漏掉、也会被 tsconfig include 干扰。

---

## Code Review Checklist

- [ ] Server/Client 边界正确（`"use client"` / `"use server"`）。
- [ ] 服务端入口都有鉴权。
- [ ] 颜色用设计 token，无裸 hex。
- [ ] DB 行经 DTO 断言，未把 `unknown` 直接插值 JSX。
- [ ] 改动到流式 / 错误码 / 鉴权时，对应单测已补或已更新。
- [ ] selector 返回值引用稳定（无无限渲染风险）。
- [ ] import 用了正确的路径别名。
- [ ] 删除/替换 UI 入口后,已清理 orphan:无引用的 props、state、ref、import,以及无人使用的 i18n 键。
- [ ] 涉及 Clipboard 等浏览器权限 API 时，已用真实用户点击验证成功与回退路径。
