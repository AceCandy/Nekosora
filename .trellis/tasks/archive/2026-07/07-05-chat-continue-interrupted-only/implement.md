# Implement: Chat 续写改为仅中断消息可触发

## 有序步骤

1. **类型补字段**：`src/features/chat/model/types.ts` 的 `ChatMessage` 加 `status?: "success" | "interrupted"`。

2. **前端标记 interrupted（方案甲核心）**：`src/features/chat/store/chatStreamStore.ts`
   - `stopGeneration`（约 523 行）：`abortController.abort()` 之后，找到 `messages` 里最后一条 `role==="assistant"` 的消息，置 `status: "interrupted"`（content 已有部分则保留，仅补 status）。
   - send / regenerate / editAndResend / continueGeneration 各自的 `finally` 正常结束时，给对应 assistant 消息置 `status: "success"`（仅在流成功完成时；被 stop 打断的不覆盖）。

3. **续写按钮显隐**：`src/features/chat/components/ChatMessageItem.tsx`（约 422 行续写按钮）
   - 由「`disabled={!content}`、始终渲染」改为「整颗按钮仅在 `content && status === "interrupted"` 时渲染」。需要把 `status` 从 props 传入（ChatMessageList → ChatMessageItem 链路确认透传）。

4. **后端 status 判定修正**：`src/app/api/chat/route.ts` 的 `start` 闭包内
   - 新增局部 `let finished = false`；在 `for await` 循环里 `ev.type === "finish"` 时置 `finished = true`。
   - finally 落库（约 276 行续写分支、294 行普通分支）的 `status` 由 `assistantText ? "success" : "interrupted"` 改为 `finished ? "success" : "interrupted"`。

5. **SSR 映射带 status**：定位 `initialMessages`（`getMessages` 返回行）→ `ChatMessage` 的映射处（`useChatRuntime` 上游 SSR 页面/数据加载），透传 `status`。`getMessages`（`conversations.ts:380`）已 `select()` 整行含 status，无需改查询。

6. **确认 hydrate 链路**：`useChatRuntime`（约 40 行）`hydrate(key, initialMessages)` → store messages 携带 status，组件订阅切片能读到。

## 验证

- `pnpm check`（lint + typecheck）必过。
- 手动：
  - 完整生成的回答 → 无续写按钮。
  - 生成中途点停止 → 出现续写按钮 → 点续写 → 从断点续写、不重复。
  - 切走会话再切回 → interrupted 消息仍显示续写按钮。
  - 续写过程再次停止 → 仍可再次续写。
  - send / regenerate / edit / delete 流程未受影响。

## 回滚点

- 类型加可选字段，对旧数据无破坏。
- 每步独立 commit，可单独 revert。
- 后端 status 判定改动与前端按钮改动解耦，可分别回滚。
