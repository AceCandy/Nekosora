# Quality Guidelines

> Nekusora 前端质量标准。

---

## Overview

从仓库根目录运行：

- `pnpm check`（工作区脚本覆盖检查 + lint + typecheck）
- `pnpm test`（根脚本 Node 测试 + 各工作区 Vitest 测试）

`pnpm lint` 递归运行各包 ESLint，所有现有 lint 脚本均启用
`--max-warnings 0`。`pnpm typecheck` 递归运行 `tsc --noEmit`，包含现有测试，
不再排除 `.test.ts`；Vitest 运行成功不能替代类型检查。
仅检查 Web 时可用 `pnpm --filter @nekusora/web check`（lint + typecheck），
但不能替代根目录的工作区覆盖门禁。

---

## Required Patterns

- **Server / Client 边界**：交互组件文件首行 `"use client"`；服务端动作用 `"use server"`。
- **服务端数据访问**：经 `requireSession` / `requireAdmin` 鉴权后再 `getDb()` / `getSchema()`，不在组件里直接访问 DB。
- **API 错误**：网关 / API route 返回错误统一走 `apiErrorLocalized(code, req)`（见 `lib/errors.ts` 契约），HTTP status 由错误码决定。
- **i18n**：错误文案经 `lib/i18n` 按 `Accept-Language` 渲染，不硬编码中文字符串进错误响应（UI 文案另接 next-intl）。
- **设计 token**：颜色一律用 `globals.css` `@theme` 注册的语义名（`sora-blue`、`nebula-white`、`twilight-obsidian`…），不用裸 hex。

---

## Testing Requirements

- **测试范围**：纯逻辑、服务端动作、路由契约与已有组件测试。文件 `<被测名>.test.ts` / `.test.tsx` 通常与被测文件同目录。
- **可测试性设计**：需要 DB 的逻辑抽 `repositories/` 接口，测试注入内存 mock（见 `route-repository.test` 配套模式）。
- **vitest 配置**：`environment: node`，include `src/**/*.test.{ts,tsx}`，别名与 tsconfig 同步映射 `@` / `@shared` / `@features`。含 JSX 的组件测试使用 `.test.tsx`，与被测组件同目录。
- **浏览器权限 API**：Clipboard 等依赖用户激活的 API 必须在真实点击中调用并做浏览器验证，不能跨服务端请求等 `await` 后再自动触发；原生 `<dialog>` 内的焦点型回退元素必须挂载在当前 dialog 内。
- 不要求所有组件 / 页面达到统一覆盖率；按风险补充测试，优先覆盖流式、鉴权、错误码与关键交互契约。
- 测试 Mock 使用实际函数签名，JSON 使用窄类型或结构匹配断言；不以新增 `any`、`as never`、`@ts-ignore` 或放宽 tsconfig 隐藏接口漂移。
- 普通 `pnpm test` 中显式隔离的 PG 测试允许跳过；只有 `pnpm test:pg` 成功才算验证了真实数据库链路。

---

## Forbidden Patterns

- **不要在 Server Component 里用 `useState` / 浏览器 API** → 加 `"use client"` 或拆子组件。
- **不要在 Client Component 顶部直接 import 含 `"use server"` 的动作之外还混入 server-only 依赖** → 用专门的 `actions.ts` 集中导出。
- **不要绕过 `requireSession` 直连 DB** → 所有服务端入口先鉴权。
- **不要用裸 hex / `text-gray-500` 这类非品牌色** → 用设计 token。
- **不要把 Web Vitest 测试放进 `src/**/*.test.{ts,tsx}` 之外或从 tsc 排除** → 会漏掉执行或类型检查。

---

## Code Review Checklist

- [ ] 根目录 `pnpm check` 零警告通过，`pnpm test` 通过；跳过项与未验证项已说明。
- [ ] Server/Client 边界正确（`"use client"` / `"use server"`）。
- [ ] 服务端入口都有鉴权。
- [ ] 颜色用设计 token，无裸 hex。
- [ ] DB 行经 DTO 断言，未把 `unknown` 直接插值 JSX。
- [ ] 改动到流式 / 错误码 / 鉴权时，对应单测已补或已更新。
- [ ] selector 返回值引用稳定（无无限渲染风险）。
- [ ] import 用了正确的路径别名。
- [ ] 删除/替换 UI 入口后,已清理 orphan:无引用的 props、state、ref、import,以及无人使用的 i18n 键。
- [ ] 删除 i18n 键前,已按 `useTranslations(namespace)` 核对完整路径；另一 namespace 的同名字面量不能替代当前键，并有 catalog 断言覆盖关键控件。
- [ ] 涉及 Clipboard 等浏览器权限 API 时，已用真实用户点击验证成功与回退路径。
