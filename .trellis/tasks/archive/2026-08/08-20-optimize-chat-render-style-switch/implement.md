# Implementation Plan

1. 调整样式派生边界
   - 在 `ChatComposer` 对完整 `activeRenderStyle` 使用 `useDeferredValue`。
   - 消息正文 props 全部从 deferred 对象派生，工具栏继续使用即时 id。
   - 验证：class、renderer、paper 标记不会来自不同选择快照。

2. 缩小消息项更新范围
   - 在 `ChatMessageList` 的稳定正文祖先挂载 `rs-*` class。
   - 仅 assistant 项接收 renderer 与 `isPaper`。
   - 从 `ChatMessageItem` 移除 CSS class 拼装，把 `isPaper` 传入 Markdown。
   - 验证：user 消息 props 稳定；renderer/paper 行为保持。

3. 更新最小回归测试
   - 优先扩展现有 Chat 组件测试，不新建测试框架或辅助抽象。
   - 锁定祖先 class、assistant-only props 与 paper 语义。
   - 验证：运行最小相关 Vitest 测试集合。

4. 独立质量复核
   - 检查当前 diff 仅覆盖本任务，确认未覆盖工作树既有改动。
   - 运行针对改动文件的 lint/type-check；如项目命令只能全量运行，先说明原因并按用户的 Java 限制无需额外批准（本任务无 Java）。
   - 复核 MessageScroller、custom/streamdown、流式和持久化契约未改变。

5. 超长会话渐进切换（用户追加批准）
   - 在 Provider 内复用 `useMessageScrollerVisibility`，首批切换可视 assistant。
   - 屏幕外 assistant 通过 `requestAnimationFrame` 固定小批量推进；新 generation 取消旧 apply/settle。
   - 将 rollout 状态变换保持为纯函数，覆盖最终收敛、user 排除、新消息与快速反向切换测试。
   - 初次打开和会话切换直接使用目标 renderer，不制造加载后的二次换肤。

6. 同步 CSS 批次与逻辑锚点（真实长会话反馈）
   - 将 `cssClass` 纳入 `RenderStyleSemantics`，从 Content 祖先恢复到 assistant 正文容器，与 renderer 同批更新。
   - 每批更新前记录首个可见 Item 相对 viewport 顶部的偏移，布局提交后按差值补偿 `scrollTop`。
   - 位于底部时跳过补偿；捕获后若 `scrollTop` 已变化也跳过，保证用户与 MessageScroller 的滚动优先；快速切换沿用 generation 取消语义。
   - 验证 CSS-only 样式切换也渐进、user Item 无 class、逻辑锚点差值与底部跳过条件。

## Validation Commands

具体测试文件以实现时现有测试结构为准，优先：

```bash
pnpm --filter @nekusora/web exec vitest run src/features/chat/components/ChatComposer.test.tsx src/features/chat/components/ChatMessageList.test.tsx src/features/chat/components/ChatMessageItem.test.tsx src/features/chat/model/progressiveRenderStyle.test.ts src/shared/components/markdown/Markdown.test.ts src/shared/components/markdown/customRenderer.test.ts
pnpm --filter web lint
pnpm --filter web typecheck
```

若 workspace 脚本名称不同，先读取 `package.json` 后使用仓库已有命令，不新增脚本。

## Risky Files / Rollback Points

- `apps/web/src/features/chat/components/ChatComposer.tsx`：当前存在未提交改动，只做局部 import/派生值调整。
- `apps/web/src/features/chat/components/ChatMessageList.tsx`：不得改变 MessageScroller 结构、key、滚动 callbacks。
- `apps/web/src/features/chat/components/ChatMessageItem.tsx`：不得改变 renderer 分支和消息操作行为。
- `apps/web/src/shared/components/markdown/Markdown.tsx`：只收窄 paper 语义 prop，不改解析器。
- `apps/web/src/features/chat/model/progressiveRenderStyle.ts`：只保存 renderer rollout 纯状态，不承载滚动或消息业务。
