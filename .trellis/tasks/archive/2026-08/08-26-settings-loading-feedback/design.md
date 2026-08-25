# 技术设计

## Change Boundary

本轮不再修改 Mem0 或 `getMemories()`。端到端数据表明服务端首字节约 23.5ms，主要慢感来自 RSC 导航期间停留旧画面，以及内容返回后额外执行 200ms 入场动画。修正应落在 `(dash)` 路由加载边界，而不是继续改记忆服务。

改动仅涉及设置路由加载反馈、指令卡展示层、返回聊天图标动效和对应设计规范；不改数据模型、CRUD、权限、导航目标或依赖。

## Route Loading

- 删除 `apps/web/src/app/(dash)/template.tsx`，避免内容到达后再做 200ms 淡入/位移。
- 新增 `apps/web/src/app/(dash)/loading.tsx`，并在 `panel` / `admin` 页面段复用该组件；共享 `(dash)` layout 会按路径重新执行，同层 fallback 无法在子页导航期间替换旧内容，子段边界才直接包住目标页面。骨架复用 `app/chat/loading.tsx` 的 App Router Suspense fallback 机制和冷调中性词汇。
- loading 只占右侧内容区，侧栏保持可见；使用固定最小高度避免布局跳动，`animate-pulse` 由全局 reduced-motion 规则降级。
- 不添加客户端导航 store、全局进度条或人工延时。

## Instruction Cards

- 移除 `Markdown` import 与正文区域，避免把内容预览当作卡片主体。
- 卡片只展示标题、`/trigger`、可选描述、使用次数和编辑/删除动作。
- 触发词使用轻量中性标签，元信息与动作放在底部，保持单层卡片、静止无投影。

## Back To Chat Hint

- 在 `globals.css` 新增 `back-to-chat-hint` keyframe：箭头每约 2.8 秒做一次克制的双次左移提示，大部分周期保持静止。
- 外层 wrapper 承担自主动画，SVG 继续承担 hover/focus/active 位移，避免 animation 覆盖交互 transform。
- 移动端与桌面端共用；`motion-reduce:animate-none` 和全局媒体查询关闭自主运动。
- 该用户明确要求的导航提示需同步到 `DESIGN.md`，作为工作区自主运动的有限例外。

## Compatibility And Rollback

- Next 路由、数据请求与页面组件接口不变。
- 每项均可按 loading、cards、sidebar/CSS 独立回滚。
- 若 loading fallback 在预取命中时不出现，属于无等待的正常行为；不得人为延迟页面只为展示骨架。
