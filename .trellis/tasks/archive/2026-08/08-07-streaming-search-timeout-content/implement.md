# 实施计划

1. 扩展内部事件与搜索尝试类型
   - 增加 `text-retract` StreamEvent 和 `skipped_after_timeout` outcome。
   - 同步内部 Chat SSE、Web SSE parser、历史安全投影和 i18n。
   - 验证：类型检查与映射单测。

2. 修复工具轮正文生命周期
   - 在 Agent step 累计已发送正文，首个工具调用出现时发送精确撤回事件，并抑制该轮后续正文 delta。
   - completion coordinator 与四条 WebChat 生成动作同步撤回正文，先处理 delta buffer 再修改消息。
   - 验证：Agent loop 事件顺序、coordinator 持久化、SSE parser、store 普通发送/继续生成测试。

3. 将 Hosted Search 改为流式 watchdog
   - 使用 AI SDK 7 `streamText().fullStream` 消费有效进度。
   - 实现 30 秒首包和 30 秒 idle timer，保留来源、摘要、用量和外层取消。
   - 验证：首包超时、跨 60 秒持续流成功、idle 超时、取消、来源归一化测试。

4. 调整 search fallback deadline
   - 外部 Provider 保留 10 秒 attempt timeout。
   - 60 秒 deadline 只限制新后端启动，不中断已开始的 Hosted 流。
   - 验证：Hosted 超时后 Tavily 回退、流完成、流失败且 deadline 到期、周到月回退测试。

5. 质量与体验复核
   - 运行 Core/Web 定向测试、类型检查、lint 和相关完整测试。
   - 浏览器验证实时状态显示“已跳过（此前超时）”，工具轮关键词被撤回且最终正文可读；调试服务结束前关闭。
   - 独立审查超时竞态、timer 清理、外层取消、continue generation 后缀撤回和历史恢复。

## Risky Files / Rollback Points

- `packages/core/src/lib/stream.ts`：Agent 事件时序；每步完成后先验证事件序列。
- `packages/core/src/lib/web-search/hosted-model.ts`：AI SDK 流消费与 timer 清理；优先定向测试。
- `apps/web/src/features/chat/store/chatStreamStore.ts`：共享 delta buffer；撤回测试必须覆盖待 flush 数据和 continue generation。
- 内部 SSE 类型与 handler 必须同一批更新，避免 Core/Web 版本不一致。
