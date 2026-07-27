# Bug Analysis: Chat 流式回复丢失底部跟随

## 1. Root Cause Category

- **Category**: E - Implicit Assumption（主因），D - Test Coverage Gap（放大因素）
- **Specific Cause**: 为恢复跨会话 `scrollTop` 而关闭原语 `autoScroll`，再在每次内容渲染后用 24px 几何阈值推断用户是否仍在底部。该判断隐含假设“离底距离只会由用户滚动改变”，但流式内容增长与异步 Markdown 布局同样会增大距离；单帧超过阈值后即被误判为用户上滑，后续永久停止跟随。

## 2. Why Fixes Failed

1. **Surface Fix**: 会话位置恢复直接关闭 `autoScroll`，解决了原语覆盖旧像素位置的表象，却移除了流式 following 状态机。
2. **Incomplete Scope**: 手动 effect 只处理渲染时刻的几何值，没有持久化“用户是否主动离底”的意图，也无法覆盖图片、字体或 Markdown 的异步布局增长。
3. **Process Gap**: 变更没有按既有滚动规范复核 `<Provider autoScroll>`、user anchor、历史位置恢复三者的完整契约，且项目没有 DOM 级滚动集成测试。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Architecture | following / anchored / free-scrolling 全部由 `message-scroller` 原语持有，业务层不实现逐帧跟随控制器 | DONE |
| P0 | Documentation | 在 frontend component spec 中补充滚动记忆与 `autoScroll` 的共存契约及禁止模式 | DONE |
| P1 | Test Coverage | 为 `{ scrollTop, atEnd }` 的记录与恢复决策补纯逻辑回归测试，覆盖 24px 边界 | DONE |
| P2 | Browser Coverage | 后续具备认证测试夹具时补长流式回复、上滑暂停、回到底恢复与跨会话恢复的 DOM/E2E 场景 | TODO（本任务范围外） |

## 4. Systematic Expansion

- **Similar Issues**: 在 `src/` 中定向检索后，未发现其他 `scrollTop = scrollHeight` 或关闭 message-scroller autoScroll 的业务实现。
- **Design Improvement**: 用户滚动意图必须由交互状态机记录，不能在内容变更后的几何快照中反推；像素位置只用于历史中段恢复，底部记忆应解析为“跟随当前末尾”。
- **Process Improvement**: 修改 Chat 滚动行为时必须同时验收正常发送、重新生成、编辑重发、用户上滑、回到底部、真实会话切换与新会话 ID 回填。

## 5. Knowledge Capture

- [x] 更新 `.trellis/spec/frontend/component-guidelines.md`。
- [x] 新增策略单测 `src/features/chat/model/chatScrollMemory.test.ts`。
- [x] 确认仓库不存在 `src/templates/markdown/spec/`，无模板同步目标，未创建推测性目录。
- [ ] DOM/E2E 滚动测试基础设施留待独立任务评估。
