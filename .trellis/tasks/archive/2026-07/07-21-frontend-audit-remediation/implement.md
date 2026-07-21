# Implementation Plan

## 1. Harden

- [x] 修改 `Button.tsx`、`Input.tsx` 的焦点状态与触屏基础类。
- [x] 修改登录页 label/id、错误语义和低对比文字。
- [x] 在 `layout.tsx` 激活系统暗色主题并同步 viewport theme color。
- [x] 验证：无障碍树、键盘焦点、亮暗对比度。

## 2. Animate

- [x] 在 `globals.css` 增加 reduced-motion 全局降级和 `.touch-target` coarse-pointer 规则。
- [x] 审阅 29 处 `transition-all`，替换无必要的宽泛过渡；保留项记录理由。
- [x] 验证：静态搜索与浏览器 reduced-motion 计算样式。

## 3. Adapt

- [x] 修复审计命中的小型直接按钮与关键侧栏入口。
- [x] 检查 320、390、768、1280px 的溢出、文本和目标尺寸。
- [x] 验证：浏览器截图、scrollWidth/clientWidth、coarse pointer 计算尺寸。

## 4. Polish

- [x] 将 UsageCharts 固定颜色迁移到语义 token，并补亮暗覆盖。
- [x] 运行 Impeccable detector，排除误报并修复真实漂移。
- [x] 检查交互状态、对齐、字体加载、控制台错误与布局位移。

## 5. Quality and Re-audit

- [x] 运行 `pnpm typecheck`、`pnpm test` 与 ESLint。
- [x] 运行 Trellis quality check，独立复核 diff 与适用规范。
- [x] 重启临时开发服务，完成桌面/移动/暗色/reduced-motion 浏览器验证后关闭服务。
- [x] 重新执行 `$impeccable audit`，输出 13/20 基线与新评分对比。

## Risky Files and Rollback Points

- `globals.css`：全局影响；每次变更后必须检查聊天与登录页基础样式。
- `Button.tsx` / `Input.tsx`：共享原语；必须静态确认全部调用方无尺寸或 focus 冲突。
- `layout.tsx`：首屏主题脚本；必须检查 hydration 与控制台。
- `UsageCharts.tsx`：仅视觉配置，不改变数据结构。
