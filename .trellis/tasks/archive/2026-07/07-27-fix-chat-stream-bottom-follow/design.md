# 技术设计

## Decision

恢复 `@shadcn/react/message-scroller` 的完整 autoScroll 状态机，并把“会话位置恢复”限制为一次显式切换到 free-scrolling 后的位置覆盖。不保留当前按消息帧手动计算 `atBottom` 的跟随逻辑。

## Data Model

滚动记忆从单一数值：

```ts
Map<string, number>
```

调整为：

```ts
interface ScrollMemoryEntry {
  scrollTop: number;
  atEnd: boolean;
}
```

- `atEnd=true`：返回会话时不恢复旧像素值，Provider 以 `autoScroll=true` 和 `defaultScrollPosition="end"` 打开当前最新内容。
- `atEnd=false`：Provider 仍保持 `autoScroll=true`；Provider 内的恢复子组件先通过公开的 `scrollToStart()` 把 mode 切为 free-scrolling，父级 layout effect 随即覆盖为保存的 `scrollTop`。后续内容不会抢位置；滚到底或显式 `scrollToEnd` 后由原语恢复 following。

`atEnd` 使用与 Provider 相同的 24px `scrollEdgeThreshold` 记录，避免两套边界定义。

## Component Flow

1. `ChatMessageList` 按 `conversationId` 读取该会话进入时的滚动记忆，生成恢复动作。
2. Provider 始终启用 autoScroll；无记忆或记忆在底部时，让 `defaultScrollPosition="end"` 与原语 following 处理当前位置。
3. 记忆在历史中段时，Provider 内的 `ScrollPositionRestorer` 通过 imperative handle 暴露一次性 `restore(scrollTop)`：先调用公开的 `scrollToStart()` 清空 anchored spacer 并切换 free-scrolling，再把 viewport 写回保存位置。
4. 父级 `useLayoutEffect` 在 Provider 自身 layout effect 之后调用恢复动作，保证首帧无闪烁；不使用定时器、合成事件或 effect 内 setState。
5. 同一组件实例若从一个真实会话 id 切到另一个真实 id：历史中段执行恢复；无历史位置则显式 `scrollToEnd`。`undefined -> 真实 id` 的新会话迁移不强制滚动，保留刚建立的 user anchor。
6. 流式内容、user 锚点、用户上滑、滚回底部和按钮点击全部继续由 message-scroller 的 following / anchored / free-scrolling 状态转换处理。
7. 现有 `ScrollAnchor` 保留；其 `scrollToEnd` 在 autoScroll 已启用时会正确转入 following。

## Test Boundary

新增一个不依赖 DOM 的滚动恢复策略模块及同目录单测，覆盖：

- 无记忆：不生成恢复动作，由原语定位底部。
- 记忆在底部：不生成恢复动作，不恢复可能过期的旧 `scrollTop`。
- 记忆在历史中段：生成 free-scrolling 位置恢复动作。
- 24px 边界内外的 `atEnd` 记录一致性。

组件真实滚动仍需浏览器验收，因为现有项目没有 jsdom/Playwright，且本任务不扩张测试基础设施。

## Compatibility And Risk

- 不升级依赖、不改 API 或 store，回滚只涉及 Chat 组件与新增纯策略文件。
- 最大风险是恢复首帧与 Provider layout effect 的执行顺序。恢复句柄由 Provider 内子组件提供，外层 `useLayoutEffect` 在子级 layout effect 后执行；恢复动作先用公开 API 明确切换 free-scrolling，再覆盖位置，避免依赖原语内部 180ms autoscrolling 超时。
- 不使用延时器、合成滚动事件或未公开 API，避免与依赖内部实现细节耦合。

## Rollback

回滚 `ChatMessageList` 的记忆结构/恢复动作与新增策略文件即可；无数据迁移和持久化副作用。
