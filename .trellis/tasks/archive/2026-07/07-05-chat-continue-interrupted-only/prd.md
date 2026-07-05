# Chat 续写改为仅中断消息可触发

## Goal

把「继续生成」按钮的可用条件从「任意 assistant 消息」收紧为「仅被中断（status=interrupted）的消息」，从源头消除「在完整回答上续写导致内容与原文雷同」的问题。续写机制本身（assistant prefill + UPDATE 原行）保持不变。

## Background

当前续写把目标 assistant 的整段已有正文作为 messages 末尾的 assistant prefill。当原文是一段已经完整结束的回答时，模型在已结束文本末尾续写，倾向复述/重写，导致续写内容与原文几乎一样。

参考项目 DEEIX-Chat（本项目 context-assembler 明确借鉴其 Slot 抽象）的续写仅允许在 `status === "interrupted"` 的消息上触发：被中断的内容天然是「被截断的半句话」，当 prefill 续写效果好、不会重复。

## Requirements

1. `ChatMessage` 类型补 `status?: "success" | "interrupted"` 字段。
2. 前端在用户点「停止」中断生成时，把当前正在生成的 assistant 消息标记为 `status="interrupted"`（方案甲：前端追踪 abort，不动 SSE 协议）。
3. 续写按钮仅当 `role === "assistant" && content 非空 && status === "interrupted"` 时渲染（现状是任意 assistant 且 `disabled={!content}`）。
4. 后端 status 落库判定改为「是否正常收到 finish 事件」：收到 finish 判 success，否则判 interrupted。修正现行 `assistantText ? success : interrupted` 的误判（中断但已有部分内容会被误判 success），保证刷新会话后前端仍能拿到正确 status。
5. SSR 初始消息 → `ChatMessage` 映射带上 status（`getMessages` 已 select 整行含 status，只需映射时透传）。

## Acceptance Criteria

- [ ] 完整生成的 assistant 回答**不显示**「继续生成」按钮
- [ ] 生成中途点「停止」后，该消息出现「继续生成」按钮
- [ ] 点续写后，内容从断点续写、不与原文重复
- [ ] 切换离开会话再切回，interrupted 消息**仍显示**续写按钮（status 已持久化）
- [ ] 续写过程本身被中途停止，同样标记 interrupted、可再次续写
- [ ] 不影响 send / regenerate / edit / delete 现有流程

## Constraints

- 续写 prefill 与 UPDATE 原行机制不变（不引入新分支、不动版本树数据模型）
- 后端 status 判定改动只影响落库字段值，不动 SSE 帧协议
- 遵循「优先新增字段/分支判断，不改既有 send/regenerate 主流程」约定
- 不在代码注释/commit message 中使用 FIXED/Step/Phase 等进度类词汇与 AI 工具名

## Notes

- 方案选择：status 同步采用「前端追踪 abort（即时标记）+ 后端 finish 判定（持久化）」组合。纯前端方案在刷新会话后会丢失 interrupted 标记，故需后端判定配合。
- 关联历史任务 `07-04-chat-message-branch-ops`：当年实现续写功能，决策为「续接产生的新内容追加到原消息、不产生新分支版本」。本任务仅调整其触发条件，不动该数据模型决策。
- 被截断内容当 prefill 续写效果已足够，不需额外追加 DEEIX 那条「请继续不要重复」user 文案（该文案适用于不用 prefill 的架构）。
