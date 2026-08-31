# 浏览器离线预检设计

## Boundary

新增一个无状态纯函数：

```ts
isBrowserOffline(): boolean
```

仅当浏览器存在且 `navigator.onLine === false` 时返回 `true`。SSR、测试缺少 navigator、状态为 `true` 或未知时允许请求继续，由现有网络错误处理接管。

该函数放在 Chat feature 的共享 `lib` 中，无事件监听、全局 Store、探活或新依赖。

## Request Flow

```text
Chat action
  -> explicit-offline guard
  -> optimistic state
  -> create/retry/edit/continue Server Action
  -> fetch /api/chat

Attachment upload
  -> explicit-offline guard
  -> fetch /api/upload

Sidebar pagination
  -> shared explicit-offline guard
  -> existing load action
```

四个 `chatStreamStore` 动作的 guard 必须位于 `streaming=true`、AbortController、乐观消息和 Server Action 之前。明确离线时直接拒绝，不创建会话、不修改版本树、不追加 assistant 错误正文。

## Feedback Contract

- 使用稳定内部原因码 `browser_offline`，由 ChatComposer 映射为 next-intl 文案。
- 发送沿用 `onRequestRejected`；重新生成、编辑重发和续写增加同形的最小可选拒绝回调，统一写入现有 `sendError`。
- 排队消息在离线拒绝后恢复到输入框，不静默丢弃。
- 上传在预检失败时进入现有可重试 `error` 状态，不清除本地 File。
- Sidebar 保持现有分页失败状态，只替换判定函数。

## Compatibility And Rollback

- `navigator.onLine === true` 不作为可达性保证，真实失败继续走现有 catch/SSE/Abort 逻辑。
- 不拦截 Image Studio、预览、Server Actions 通用层或服务端 Provider 请求。
- 回滚只删除共享纯函数及三个调用点组，不需要清理持久数据。

## Validation

- 纯函数测试覆盖 SSR、缺失属性、true 和 false。
- Store 测试覆盖四动作在离线时 Server Action/`fetch` 零调用、零状态污染，以及恢复在线后成功。
- Composer/附件测试覆盖本地化反馈、输入/队列/附件保留和在线重试。
