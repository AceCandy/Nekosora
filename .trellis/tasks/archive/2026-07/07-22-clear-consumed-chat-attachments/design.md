# 已消费聊天附件清理设计

## Data Flow

```text
Composer attached state
  -> uploadPending(conversationId) -> fileIds
  -> chatStreamStore.fetch(/api/chat)
       non-ok / no body -> retain attachments
       ok + body        -> onAttachmentsConsumed(fileIds)
                            remove uploaded ids from this request only
                            revoke their preview URLs
                          -> consumeChatSSE
                               later SSE failure does not restore attachments
```

## Callback Contract

`ChatStreamState.send` 的 hooks 新增 `onAttachmentsConsumed?: (fileIds: string[]) => void`。该回调表示服务端已接受参数中 `fileIds` 对应的聊天请求，不表示整段生成成功。调用点固定在 response ok/body 校验之后、`consumeChatSSE` 之前。

`useChatRuntime` 只负责透传；`ChatComposer` 将其绑定到 `useChatAttachments` 的消费动作。附件 hook 使用 functional state update，只过滤 `status === "uploaded"` 且 fileId 位于本轮参数中的项，避免闭包陈旧并保留并发新增、失败或进行中项。

## Compatibility / Risk

- 不改变请求字段或后端 API。
- 不在 fetch 失败时清空，用户仍可保留附件状态。
- response 接受后即清空符合“附件属于当前 user turn”语义；SSE 中断只影响 assistant 生成，不应把附件带入下一 turn。
- 服务器文件清理由独立生命周期任务处理，本任务只修正客户端重复发送。
