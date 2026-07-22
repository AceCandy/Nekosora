# 消息接收后清空已消费附件

## Goal

让聊天附件只参与用户明确发送的当前一条消息：服务器接受 `/api/chat` 请求后清除已成功上传的附件，避免后续消息自动重复携带同一批 `fileIds`；请求未被接受时保留附件以便重试。

## Background

- `uploadPending()` 每次发送都会收集当前所有 `status='uploaded'` 的 fileId。
- `useChatAttachments` 提供的 `resetAttachments()` 没有调用方，Composer 发送成功后附件状态一直保留。
- `chatStreamStore.send()` 在构造每次 `/api/chat` body 前都会调用 `uploadAttachments`，因此旧附件会进入后续所有消息。
- 同一批附件的失败项可能与成功项并存，成功消费不能清掉仍需用户处理的 `error/uploading` 项。

## Requirements

- R1：扩展 send hooks，新增携带本轮 `fileIds` 的“附件已被服务器接受”回调，并在 `/api/chat` 返回 ok 且 body 存在后、消费 SSE 前调用一次。
- R2：非 2xx、无 response body、fetch 抛错或附件上传阶段失败时不得调用消费回调。
- R3：SSE 在响应被接受后中断时，附件仍视为已消费，不得重新出现在下一条消息。
- R4：`useChatAttachments` 的消费动作只移除 `uploaded` 且 fileId 属于回调参数的项并释放这些项的 preview object URL；保留新上传及 `pending/uploading/error` 项。
- R5：由 `useChatRuntime` 透传回调，ChatComposer 绑定附件消费动作；不新增可见 UI、提示或动效。

## Acceptance Criteria

- [x] AC1：store 单测证明成功响应调用消费回调一次，request body 包含本轮 fileIds。
- [x] AC2：store 单测证明非成功响应不调用消费回调；响应成功后 SSE 失败仍已调用。
- [x] AC3：源码复核与类型检查证明回调从 Composer -> runtime hook -> store 完整透传。
- [x] AC4：附件 hook 仅移除 uploaded 项并 revoke 对应 preview URL，失败/进行中项保留。
- [x] AC5：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。

## Out Of Scope

- 删除服务器上的已上传对象或 `file_objects` 行。
- 为失败附件新增重试按钮或错误提示。
- 在消息历史中持久化/回显附件元数据。
