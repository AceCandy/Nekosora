# Chat 消息虚拟滚动

## Goal

消息列表改用虚拟滚动，解决长会话（数百条以上）渲染卡顿。重写 `useChatScrollController` 适配虚拟化。属架构级任务，最后做。

## Requirements

- 消息列表引入虚拟滚动（`virtua`），仅渲染可视区 + 缓冲区消息
- 保留现有滚动控制器的全部行为：
  - 贴底自动跟随流式输出
  - 用户上滑停止跟随
  - 发送消息 forceFollow 回到底部
  - easeOutCubic 平滑滚动
  - 「跳到最新」浮按钮
- 版本切换（switchVersion）能正确 scrollIntoView 到目标消息
- 对话大纲（ChatOutline）跳转、文本选中工具栏定位在虚拟化后仍准确（回头适配）
- 欢迎屏（空状态）在虚拟列表为空时正常展示
- 动态高度：消息高度不一（含折叠/展开），虚拟化需支持动态 measure

## Acceptance Criteria

- [ ] 数百条消息会话滚动流畅（无明显掉帧）
- [ ] 流式输出贴底跟随正常
- [ ] 上滑停止跟随、发消息回底、「跳到最新」均正常
- [ ] 版本切换、大纲跳转能定位到目标消息
- [ ] 选区工具栏定位准确（与 selection-toolbar 联调）
- [ ] 空会话显示欢迎屏
- [ ] 折叠/展开思考、工具调用后高度变化不错位

## Constraints

- 不破坏流式渲染（流式期间频繁追加消息，虚拟列表需高效追加）
- `virtua` 已在 kivio 验证可用；如评估后不合适，design 阶段可在 virtua / react-virtuoso 间重选
- 改动范围大，须有回滚点（保留旧滚动控制器可切换）
- 最后做：需回头适配 selection-toolbar、welcome-screen、大纲跳转

## Notes

- 参考 kivio `MessageList.tsx`（virtua Virtualizer）
- 架构级任务，须补 `design.md`（虚拟化方案、动态高度测量、控制器重写边界、回滚策略）+ `implement.md`
