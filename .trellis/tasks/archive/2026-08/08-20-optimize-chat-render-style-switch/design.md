# Technical Design

## Boundaries

- `ChatComposer`：保留即时的 composer 选择状态；对消息正文使用 `useDeferredValue(activeRenderStyle)`。
- `ChatMessageList`：只给 assistant 项传 rollout 解析出的 cssClass、renderer 与 `isPaper`。
- `ProgressiveRenderStyle`：位于 `MessageScroller.Provider` 内，复用 `visibleMessageIds`，可视 assistant 首批同时切 CSS/renderer，屏幕外 assistant 每帧小批量收敛；每批提交后保持首个可见消息的视口偏移。
- `progressiveRenderStyle.ts`：保存可测试的 rollout 状态变换；generation 使旧批次在快速切换后失效。
- `ChatMessageItem`：移除仅为 CSS 选择器传递的 `renderStyleClass`，改为语义更窄的 `isPaper`；对既有 Markdown 接口仍映射为 `paper`，避免影响公开分享调用方。

## Data Flow

```text
composer.renderStyleId (即时，供工具栏)
  -> activeRenderStyle
  -> useDeferredValue(activeRenderStyle) (消息正文)
     -> ProgressiveRenderStyle
        -> visible assistant: target cssClass + renderer + isPaper
        -> offscreen assistant: requestAnimationFrame batches
        -> mid-history: preserve first visible message viewport offset
     -> assistant ChatMessageItem: resolved rs-{cssClass} + renderer + isPaper
        -> Markdown renderer + paper code-block context
```

cssClass、renderer 和 `isPaper` 必须从同一个延迟对象派生并由同一个 rollout 状态解析，不能分别 deferred，以免一次提交中出现样式与渲染器不一致。

## Compatibility

- 现有管理员 CSS 选择器形如 `.rs-paper .nekusora-md`；`rs-paper` 恢复到优化前的 assistant 正文容器，保持既有 DOM 语义。
- user 消息不接收 cssClass、renderer 或 paper props，不参与换肤。
- custom renderer 信任边界、裸 URL probe、Streamdown 流式回退不变。
- 不修改保存快照的 Server Action 或 `LatestSnapshotWriter`。
- 初次打开或切换会话直接使用保存的目标 renderer；渐进切换只发生在同一会话内的样式互切。
- 切换期间新增的消息直接使用最新目标 renderer；最终全部历史 assistant 收敛到最新选择。
- 历史中段以首个可见 MessageScroller Item 的 `viewportTop` 为逻辑锚点；每批布局后只补偿该元素的 top 差值。位于底部时不补偿，由现有 autoScroll 跟随。
- 锚点同时记录捕获时的 `scrollTop`；提交前若它已变化，说明用户或 MessageScroller 已接管滚动，本批放弃补偿。可见性列表仅用于候选排序，最终锚点必须与视口真实相交。

## Trade-offs

- 不增加自定义 `React.memo` comparator，避免遗漏 props 导致陈旧 UI。
- 不缓存 Markdown HTML，避免缓存键、内存上限和异步图片探测一致性复杂度。
- 不采用虚拟化；项目规范已明确其与 MessageScroller 契约不兼容。
- 不采用 `content-visibility`；避免估算高度影响 `scrollHeight`、滚动记忆和锚点。
- 接受切换期间屏幕外消息短暂保留旧 renderer，以换取可视内容优先和主线程分帧；用户已明确批准该行为。

## Rollback

改动仅涉及 props、class 挂载位置、客户端 rollout 状态与样式切换期的滚动补偿，可按文件直接回退；无迁移、数据格式或外部接口变化。
