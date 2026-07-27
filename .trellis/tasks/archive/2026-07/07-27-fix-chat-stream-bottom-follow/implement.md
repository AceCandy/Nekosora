# 实施计划

1. 新增纯滚动恢复策略与失败单测。
   - 覆盖无记忆、底部记忆、历史中段记忆和 24px 边界。
   - 验证：定向 Vitest 首次失败，证明测试能捕获缺失契约。
2. 调整 `ChatMessageList`。
   - 记忆 `scrollTop + atEnd`。
   - Provider 恢复 `autoScroll`，增加只负责一次性历史位置恢复的原语内子组件。
   - 删除 `[messages, streaming]` 手动跟随 effect。
   - 保留 `ScrollAnchor` 与 message-scroller 原语调用。
   - 验证：定向 Vitest 通过，TypeScript 无新增错误。
3. 核验会话身份转换。
   - 真实会话之间切换按记忆恢复或回到当前底部。
   - 新会话 `undefined -> 真实 id` 时不清除已建立的 user anchor。
4. 运行质量门槛。
   - `pnpm test -- <定向测试>`。
   - `pnpm check`。
   - `pnpm test`。
5. 浏览器定向验收。
   - 使用已有本地服务；若登录态仍不可用，明确记录未验证，不读取或创建凭据。
   - 覆盖长回复跟随、上滑暂停、回到底恢复、会话位置恢复。
   - 若为验证启动新服务，结束前关闭。
6. 独立复核。
   - 检查与 frontend component/hook/quality 规范一致。
   - 检查 diff 只包含任务文件、Chat 滚动修复和对应测试，无临时产物或敏感信息。

## Risky Files

- `src/features/chat/components/ChatMessageList.tsx`：滚动状态机集成点。
- `src/features/chat/model/chatScrollMemory.ts`：滚动记忆与恢复策略。

## Stop / Rollback Points

- 若 `scrollToStart()` 切到 free-scrolling 后仍会在恢复首帧自动抢回历史位置，停止实现，不使用延时器绕过，回到设计阶段重新评估原语边界。
- 若新会话 id 回填会清除 user 锚点或提前贴底，停止并保留该迁移阶段的现有 Provider 状态。
