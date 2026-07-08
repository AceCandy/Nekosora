# 会话切换动效

## Goal

为 chat 左侧会话 tab 切换加入进入动效，消除当前纯瞬切的生硬感；同时补齐缺失的动效工具链（项目原有 `animate-in` 类全为无效死类）。

## Background

调研：`package.json` 无 `tailwindcss-animate` / `framer-motion`，`globals.css` 全文零 `@keyframes` / `@plugin`，导致代码中所有 `animate-in fade-in slide-in-from-*` 等类无效（死类）。会话切换走 Next.js `<Link>` client 导航，`[id]/page` 重新挂载 `ChatComposer`，消息区无过渡 → 生硬。

## Requirements

1. 引入 `tw-animate-css`（`tailwindcss-animate` 的 Tailwind v4 CSS-only 适配版），`@import` 进 `globals.css`，激活所有现有 `animate-in` 死类。
2. 会话切换时消息区有进入动效（fade-in + 微上滑），不破坏既有滚动 / 虚拟化 / 流式逻辑。
3. 动效克制（duration ≤ 200ms、小幅位移），符合「星枢天流」克制设计。

## Constraints

- 不引入 `framer-motion`（避免重依赖、不改组件写法）。
- 动效仅作用于会话切换的内容进入，不扩散到流式增量、消息项等高频路径。
- 不改变选择器结构与滚动逻辑。

## Acceptance Criteria

- [ ] 点击侧栏会话切换时，消息区柔和淡入（非瞬切）。
- [ ] 原有 `animate-in fade-in` 等死类激活（如欢迎页、消息项淡入可见）。
- [ ] 明暗模式正常；流式、虚拟滚动、回到最新按钮不受影响。
- [ ] `pnpm lint` 通过。
