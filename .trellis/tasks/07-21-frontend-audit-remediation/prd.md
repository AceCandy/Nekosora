# 修复前端审计问题并复评

## Goal

按 `impeccable harden -> animate -> adapt -> polish -> audit` 的顺序，修复 2026-07-21 前端技术审计确认的问题，并使用相同审计口径给出修复前后评分对比。

## Background

修复前审计评分为 **13/20（可接受）**：Accessibility 1/4、Performance 3/4、Responsive 3/4、Theming 2/4、Anti-Patterns 4/4。

已确认的问题：

- `Button.tsx:L21` 清除 outline，但共享按钮没有统一可见的 `focus-visible` 样式；浏览器实测焦点 ring 透明。共享按钮在 18 个文件中出现 53 次。
- `Input.tsx:L17-L18` 声明的焦点 ring 在浏览器计算样式中不可见。
- `LoginPage.tsx:L47-L66` 的 label 未通过 `htmlFor` / `id` 关联输入框，密码框在无障碍树中没有名称。
- `LoginPage.tsx:L41,L87` 的次要文字对比度为 2.54:1，邮箱 placeholder 为 3.85:1，低于小号文字 4.5:1 要求。
- `globals.css` 没有 `prefers-reduced-motion` 全局降级；源码有 39 处动画、仅 5 处局部 `motion-reduce`，另有 29 处 `transition-all`。
- 暗色样式依赖 `.dark`，但 `layout.tsx` 与其他运行时代码没有设置该 class，暗色主题不可达。
- 部分图标按钮和侧栏入口不足 44x44px；`UsageCharts.tsx` 还存在未进入设计 token 的固定颜色。

## Requirements

### R1. Harden

- 登录页所有输入框必须具有稳定、程序化关联的可访问名称。
- 动态错误信息必须能被辅助技术感知，且不丢失用户输入。
- 共享 Button 与 Input 的键盘焦点必须在亮色和暗色背景上清晰可见。
- 登录页正文、次要文字和 placeholder 必须达到 WCAG AA 4.5:1。
- 暗色主题必须随系统 `prefers-color-scheme` 实际生效，不能只保留不可达样式。

### R2. Animate

- 全局尊重 `prefers-reduced-motion: reduce`，动画与过渡提供即时或近即时替代。
- 将审计命中的宽泛 `transition-all` 收敛为实际需要的属性；保留侧栏宽度等有明确用途的属性过渡。
- 不新增装饰性动效、弹跳或弹性 easing。

### R3. Adapt

- 关键触屏操作在 coarse pointer 下至少 44x44px，同时保持桌面管理界面的合理密度。
- 登录页以及本次改动涉及的共享控件在 320、390、768、1280px 视口无横向溢出或文字遮挡。
- 不依赖 hover 才能完成关键操作。

### R4. Polish

- `UsageCharts.tsx` 的图表、坐标轴、网格和 tooltip 颜色必须复用 `globals.css` 设计 token，并适配亮暗主题。
- 修复过程中不得引入裸 hex、无关重构、新依赖或新的视觉模式。
- 保持「星枢天流」product register：克制、静止无投影、无彩色侧边粗条。

### R5. Re-audit

- 使用与修复前相同的五维审计口径重新评分并列出差异。
- 对无法覆盖的鉴权后运行态或真实设备测试明确标注，不以静态扫描代替运行态证据。

## Acceptance Criteria

- [x] AC1：浏览器无障碍树中登录邮箱和密码输入框均显示正确名称，错误信息使用可感知状态语义。
- [x] AC2：键盘 Tab 聚焦 Button/Input 时 `:focus-visible` 为真且 outline/ring 非透明；亮暗主题均可辨认。
- [x] AC3：登录页副标题、返回链接、placeholder 的实测对比度均不低于 4.5:1。
- [x] AC4：模拟系统暗色偏好后页面自动进入暗色，图表与自定义 prose 颜色同步切换。
- [x] AC5：模拟 reduced motion 后 CSS 动画迭代次数与持续时间被降级，核心交互仍可用。
- [x] AC6：审计范围内不再存在无必要的 `transition-all`；保留项必须有明确布局过渡理由。
- [x] AC7：coarse pointer 下关键按钮的计算尺寸不小于 44x44px；320/390/768/1280px 无水平滚动。
- [x] AC8：Impeccable detector 不再报告 `UsageCharts.tsx` 的未文档化颜色。
- [x] AC9：`pnpm typecheck`、`pnpm test` 通过；Lint 不新增 warning，并记录既有 warning 状态。
- [x] AC10：重新运行 `$impeccable audit`，输出修复前 13/20 与修复后评分、剩余风险和未覆盖项。

## Out of Scope

- 不新增手动主题切换器或持久化主题偏好。
- 不重设计登录页、后台信息架构或聊天交互。
- 不修复与本次 UI 审计无关的既有 ESLint warning。
- 不修改服务端业务逻辑、数据库、API 或鉴权协议。
