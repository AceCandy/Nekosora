# Chat Message Time Separators

## 1. Scope / Trigger

修改消息 `createdAt` 投影、`user_message` / `assistant_message` SSE 身份帧、Chat store 消息生命周期、公开分享消息快照或正文时间分隔时，必须遵守本契约。时间分隔是展示信息，不属于消息正文、模型上下文或消息排序依据。

## 2. Signatures

- 数据库事实源：`messages.createdAt`，非空绝对时间。
- Chat DTO：`ChatMessage.createdAt?: string`，值为 ISO 8601 绝对时间。
- 分享快照：`ConversationShareMessageSnapshot.createdAt?: string`。
- 身份 SSE：`{ type: "user_message" | "assistant_message"; publicId: string; createdAt?: string }`。
- 客户端 handler：`onUserMessage(publicId, createdAt?)` / `onAssistantMessage(publicId, createdAt?)`。
- 展示规则：`getMessageTimeSeparatorInfo({ createdAt, previousCreatedAt, isFirst, now, locale, timeZone })`。

## 3. Contracts

- Server Component 向 Client Component 传递时间前必须序列化为 ISO 字符串，不传 `Date`。
- 新 user 与新 assistant 由服务端各生成一次创建时间；同一个值同时用于数据库写入和身份 SSE。客户端可先使用乐观时间，但收到 SSE 后以服务端值覆盖。
- regenerate 与 edit-resend 新建 assistant，使用新时间；edit 原地更新 user，保留 user 原时间；continue 原地更新 assistant，保留 assistant 原时间，身份 SSE 也返回该原时间。
- 历史 Chat、版本切换、snapshot 分享和 live 分享都投影同一个消息绝对创建时间。snapshot 创建时冻结该值；live 每次读取当前可见消息。
- 功能上线前的旧 snapshot 缺少 `createdAt` 时继续展示正文，不回查原会话补时间。缺失或无效时间一律不渲染分隔。
- 日期判断使用访问者浏览器时区的日历年月日，不用毫秒差推断昨天，也不使用服务端固定时区。Server Render 返回无分隔，hydration 后再读取 `Intl.DateTimeFormat().resolvedOptions().timeZone`。
- 第一条消息仅在不属于访问者今天时显示；后续消息仅在与紧邻上一条消息不属于同一本地自然日时显示。同日间隔多久都不重复显示。
- 展示格式按当前 locale 本地化：今天仅 `HH:mm`，昨天/前天使用对应文案，今年更早显示月日，往年额外显示年份。
- `<time dateTime="ISO">` 只出现在展示层，不写回消息内容，不进入复制正文或模型请求。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 第一条消息属于访问者今天 | 不显示分隔 |
| 第一条消息早于访问者今天 | 按相对日期或年月日显示 |
| 后续消息与上一条同一本地自然日 | 不显示分隔 |
| 后续消息与上一条跨本地自然日 | 在后一条消息前显示 |
| 时间缺失、无效或时区无效 | 正文照常显示，分隔返回 `null` |
| DST 导致一天为 23 或 25 小时 | 仍按本地日历日期判断 |
| 旧 snapshot 无 `createdAt` | 不查消息表补值，不显示分隔 |
| continue 更新既有 assistant | 数据库 UPDATE 不包含 `createdAt`，SSE 返回原时间 |

## 5. Good / Base / Bad Cases

- Good：上海和洛杉矶访问同一分享链接，按各自自然日得到不同但正确的分隔位置。
- Good：用户在第二天重新打开会话，原本无标签的第一条消息显示本地化的“昨天 + 时分”。
- Base：旧分享只有 role/content，正文继续可读且没有时间标签。
- Bad：服务端按部署时区先格式化标签，导致 SSR 与访问者时区不一致或 hydration mismatch。
- Bad：续写时把 assistant 的 `createdAt` 改成续写时间，造成即时 UI 与刷新后分组不一致。
- Bad：为旧 snapshot 回查当前消息时间，破坏快照对编辑、删除和分支变化的独立性。

## 6. Tests Required

- 纯逻辑测试固定 `now`、`locale` 与 `timeZone`，覆盖首条今天/非今天、同日/跨日、昨天/前天、今年/跨年、DST 和无效输入。
- route 测试断言新消息持久化时间与身份 SSE 相同，并断言 continue UPDATE 不含 `createdAt`。
- SSE parser 与 store 测试覆盖 send、regenerate、edit-resend、continue 的服务端时间回填，以及版本切换替换目标版本时间。
- 分享 action 测试覆盖 snapshot 冻结、live 投影、旧 snapshot 不回查和 legacy 缺失时间降级。
- 浏览器验证至少覆盖两个时区、桌面与 390px 窄屏、显式暗色样式、无横向溢出、无 hydration/console error，以及旧分享没有 `<time>`。

## 7. Wrong vs Correct

```typescript
// Wrong: 用运行时所在时区预先生成标签，并在续写时重置消息时间。
const label = formatInServerTimeZone(message.createdAt);
await tx.update(messages).set({ content, createdAt: new Date() });

// Correct: 只跨边界传绝对时间；客户端按浏览器时区展示，续写保留原时间。
const createdAt = toMessageCreatedAtIso(message.createdAt);
await tx.update(messages).set({ content });
```
