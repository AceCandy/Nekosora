# 聊天消息时间分隔展示设计

## Boundaries

本功能跨越消息持久化投影、聊天流式运行时、分享快照和两个展示入口。时间分隔本身只属于 UI；跨层改动仅负责保留消息已有的创建时间，不把标签文本写入任何消息或模型请求。

## Data Contracts

- `ChatMessage.createdAt?: string`：客户端聊天消息的 ISO 8601 绝对时间，可选以兼容旧运行时数据。
- `ConversationShareMessageSnapshot.createdAt?: string`：分享快照中的 ISO 8601 绝对时间，可选以兼容旧 JSON。
- `PublicShareState.ready.messages[].createdAt?: string`：公开分享 DTO 的可选 ISO 时间。
- `user_message` / `assistant_message` SSE 帧在现有 `publicId` 之外携带可选 `createdAt`；对应 handler 一次回填身份和创建时间。

Client Component 边界只传字符串，不传 `Date`。缺失或无效时间不抛错，展示层直接不渲染对应分隔。

## Data Flow

### 历史 Chat

`messages.createdAt (Date)` → 会话页面 DTO 边界 `.toISOString()` → `ChatMessage.createdAt` → `ChatMessageList` → 时间分隔组件。

### 流式 Chat

1. store 为即时出现的 user/assistant 乐观消息赋一个 ISO 时间。
2. `/api/chat` 在创建本轮 user 行和 assistant 占位身份时生成服务端时间。
3. user 行写入该时间；新 assistant 最终落库时复用预先生成的时间，续写更新既有 assistant 时不改原创建时间。
4. 现有身份 SSE 帧同时发送 `publicId` 和 ISO `createdAt`，store 用服务端值覆盖乐观值。
5. regenerate/edit 新建的 assistant 使用新时间；edit 复用的 user 和 continue 复用的 assistant 保留原时间。

这样实时展示与刷新后的数据库投影保持一致，不依赖客户端时钟作为最终事实来源，也不新增消息排序机制。

### 公开分享

- snapshot：创建时把当前可见分支每条消息的 `createdAt` 冻结为 ISO 字符串。
- live：读取时从当前可见消息投影 ISO 时间。
- legacy / 旧 snapshot：缺少时间字段时不回查原会话，正文照常渲染且不显示时间分隔。

## Presentation Logic

新增一个 chat 特性内共享的纯日期函数和一个低干扰时间分隔组件，Chat 与分享页共同使用。

纯函数输入包括当前消息时间、上一条消息时间、是否列表首条、参考当前时间、locale 和显式 time zone。它负责：

1. 用 `Intl.DateTimeFormat(..., { timeZone }).formatToParts()` 取得指定时区的年月日，避免依赖服务器本地时区。
2. 用本地日历日期而非毫秒差判断今天、昨天、前天和跨日，避免夏令时边界错误。
3. 第一条今天返回无标签；第一条非今天返回标签；后续仅在与上一条消息不同本地自然日时返回标签。
4. 使用 `hourCycle: "h23"` 输出固定 `HH:mm`；日期部分按当前 locale 本地化。

组件使用 `useLocale()` 与 `useTranslations("chat")` 复用现有“昨天/前天”文案。它通过项目已有的 `useSyncExternalStore` SSR 安全模式在 hydration 后读取浏览器时区；服务端不猜测访问者时区，也不输出可能与客户端结构冲突的标签。

分隔元素使用语义化 `<time dateTime="...">`，居中、`text-ui-micro` 和中性次级文字色，不加边框、阴影、动画或装饰。Chat 中放在对应 `MessageScroller.Item` 内、消息正文之前，保持 scroller 子项结构；分享页放在对应只读消息之前。

## Compatibility And Rollback

- 所有新增时间字段均为可选；旧 store 数据和旧分享 JSON 无需迁移。
- 不新增 PostgreSQL 字段或迁移；`messages.createdAt` 已存在。
- 不修改消息内容、模型请求 messages、复制正文、分支选择或软删除规则。
- 回滚可直接移除 UI 与新增投影字段；已经写入分享 JSON 的额外可选字段会被旧代码忽略。

## Verification

- 纯逻辑测试固定 `now`、locale 和 time zone，覆盖首条、同日/跨日、相对日期、跨年、夏令时/时区边界和无效输入。
- SSE/parser/store 测试验证服务端时间回填和各生成路径的时间保留。
- share action 测试验证新 snapshot/live 时间投影与旧 snapshot 缺失时间降级。
- 浏览器检查 Chat 与公开分享在桌面/窄屏、亮/暗主题下的居中标签、无横向溢出、无 hydration 或控制台错误，并确认消息滚动/锚点未回退。

