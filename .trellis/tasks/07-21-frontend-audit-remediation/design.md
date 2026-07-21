# Technical Design

## Scope and Boundaries

改动限制在前端展示层：`src/app/`、`src/shared/ui/`、少量被审计命中的 feature/page 组件。不得修改后端、数据模型或鉴权协议。

## Design Decisions

### Focus and form semantics

- 在共享 `Button` / `Input` 原语统一补齐焦点样式，避免调用方重复修复。
- 登录页为 label/input 使用稳定 id，并用 `aria-describedby` / `role="alert"` 关联错误状态。
- 使用不透明语义色 ring，避免自定义 Tailwind 色叠加透明度后编译为透明值。

### Theme activation

- 保留现有 `.dark` 变体与 raw CSS 约定。
- 在首屏脚本中根据 `prefers-color-scheme: dark` 同步 `<html>.dark`，并监听系统主题变化。
- `viewport.themeColor` 同时声明亮暗媒体值，避免浏览器外壳始终为白色。
- 不增加主题按钮或 localStorage，确保改动最小且符合当前系统主题语义。

### Reduced motion

- 在 `globals.css` 增加统一的 reduced-motion 媒体查询，覆盖 CSS 动画、过渡和 smooth scrolling。
- 将宽泛 `transition-all` 改为 `transition-colors`、`transition-opacity`、`transition-transform` 或明确属性列表。

### Touch adaptation

- 增加可复用 `.touch-target` 类，仅在 `pointer: coarse` 下提升到 44px，桌面密度不变。
- 共享 Button 默认携带该类；直接实现的关键图标按钮按审计结果补齐。

### Chart tokens

- 在 `globals.css` 扩展图表 axis/grid/tooltip 语义变量，并在 `.dark` 下覆盖。
- Recharts 配置只引用 CSS variables，不维护第二份主题判断。

## Compatibility

- 目标为项目当前支持的现代浏览器；`matchMedia` 与 change listener 均有广泛支持。
- 不改变组件 props 或服务端数据契约。
- 所有颜色继续由 Tailwind v4 `@theme` / CSS variable 管理。

## Rollback

- 每个阶段保持独立 diff：共享原语与登录页、全局动效、触屏目标、图表 token。
- 若首屏主题脚本导致 hydration 或 CSP 问题，可单独回退主题激活部分，不影响其他修复。
