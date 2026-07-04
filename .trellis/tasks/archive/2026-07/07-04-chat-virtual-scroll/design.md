# Design: Chat 消息虚拟滚动

## 决策
- 用 `@tanstack/react-virtual` 的 `useVirtualizer`，仅渲染可见消息项 + overscan 缓冲。
- **保留 useChatScrollController 不动**：它基于 `scrollHeight` / `endRef.scrollIntoView`，虚拟化后外层撑高 div 的 `height = totalSize`，`scrollHeight` 仍正确，贴底测量 / 跟随 / 平滑滚动逻辑继续生效。
- `endRef`（底部锚点）保留在虚拟容器之后（仍在 scrollRef 内），`scrollIntoView` 仍可达。

## 渲染结构
- `scrollRef` 容器（overflow-y-auto）内：
  - `messages` 空 → 欢迎屏（不虚拟化）
  - 非空 → `height=getTotalSize()` 的相对定位 div；虚拟项绝对定位 `translateY(vi.start)` + `measureElement` 动态测高
- `estimateSize` 200，`overscan` 4

## 连带影响
- selection-toolbar：基于 `getBoundingClientRect`，虚拟项 DOM 仍在视口内，定位不受影响。
- 大纲跳转 / 版本切换 `scrollIntoView`：依赖 `domId`，**仅对当前可见项生效**；跳到不可见消息需改用 `virtualizer.scrollToIndex` —— 已知限制，本任务不接（标注）。

## 风险（需手动运行验证）
- 流式追加时 `measureElement` 与 controller `scrollIntoView` 可能轻微抖动。
- 跳转到不可见消息受虚拟化限制。
- **本会话无法运行 app 验证流式/滚动体验**，提交后需手动测试；有问题 `git revert` 即可回滚（纯渲染层改动）。
