# 修复记忆日期缓存与新对话切换

## Goal

消除两个相互独立但都会表现为界面操作失效的缺陷：记忆管理页在缓存命中后因日期类型变化而崩溃，以及聊天侧栏进入“新对话”后仍残留旧会话活动状态。

## Background

- `getMemories()` 将 mem0 的 `createdAt` 转为 `Date`，但 Keyv 缓存会把日期序列化为字符串；`src/app/(dash)/panel/memory/page.tsx:42` 排序时直接调用 `.getTime()`，导致缓存命中后的服务端渲染失败。
- 新会话通过 `history.replaceState` 把地址从 `/chat` 改为 `/chat/:id`，但 Next 内部路由仍可能停在 `/chat`；再次点击普通 `/chat` 虽收到 200 RSC，React 仍复用持有旧 `activeConvId` 的 ChatComposer。必须以一次性导航 key 强制重挂，之后再由新会话 runtime 清除旧活动态。

## Requirements

- 记忆页必须兼容 `createdAt` 为 `Date`、可解析日期字符串、空值或无效值，且排序不得抛出运行时异常。
- 记忆分组内仍按创建时间倒序排列；缺失或无效日期按时间值 `0` 处理。
- 进入 `/chat` 新对话状态后，侧栏不得继续将旧会话 ID 视为当前活动会话。
- 不改变新会话创建后的静默 URL 替换与流式响应机制，不中断其他会话的后台流式状态。
- 修改保持局部，不处理日志中的 PostgreSQL `client.query()` 弃用警告。

## Acceptance Criteria

- [x] 记忆数据首次读取与 Keyv 缓存命中后，均可完成日期排序且不发生 `getTime is not a function`。
- [x] `createdAt` 为 `Date` 和 ISO 字符串时均按时间倒序排列；空值或无效值不会导致异常。
- [x] 从具体会话 `/chat/:id` 进入 `/chat` 后，旧会话不再保持活动态，新对话界面可正常交互。
- [x] 新会话创建与流式输出的既有 URL/runtime 迁移行为保持不变。
- [x] 为两处根因补充针对性回归测试，并通过相关测试与类型检查。

## Notes

- 本任务按轻量缺陷修复处理，采用 PRD-only；实现前仍需用户批准本摘要。
- 当前工作树包含另一活跃任务遗留的大量未提交改动，实现时不得覆盖或整理无关文件。
