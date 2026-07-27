# 修复会话标题实时更新

## Goal

后台 worker 生成并持久化最终会话标题后，当前聊天页面和侧边栏无需整页刷新即可及时显示最终标题，同时保留现有标题任务的异步执行、可靠重试和人工改名保护。

## Background

- 新会话首次发送时，`chatStreamStore` 使用首条消息截断值创建 `optimisticConversation`，因此页面先显示用户原话。
- `/api/chat` 仅执行 `writeFallbackTitle` 并异步投递 `conversation-title` job（`src/app/api/chat/route.ts:258-275`）。
- worker 完成后只更新 `conversations.title` 并删除 outbox，未向浏览器发布完成通知（`src/worker.ts:56-62`、`src/lib/conversation-title/service.ts:198-211`）。
- 前端已经定义并消费 `title_updated(title, conversationId)`，但后端没有生产该事件（`src/features/chat/model/sse.ts:114-115`、`src/features/chat/store/chatStreamStore.ts:412-420`）。
- 项目目前没有通用 WebSocket、Redis Pub/Sub、PostgreSQL LISTEN/NOTIFY 或独立服务端事件总线。现有 `/api/chat` SSE 在 `[DONE]` 后关闭，不能自然承接之后完成的 worker 任务。

## Requirements

- R1：后台标题成功落库后，发起该对话的当前页面必须自动收敛到最终标题，不要求用户刷新页面。
- R2：聊天回答流不得等待标题模型或 worker 完成；标题失败、重试或恢复扫描不得阻断回答。
- R3：保留现有 outbox、pg-boss 重试、job-id fencing 和人工改名保护语义。
- R4：客户端只查询当前登录用户有权访问的会话；不能通过会话 ID 读取他人标题或任务状态。
- R5：客户端轮询与当前会话、组件生命周期解耦；会话切换、组件重挂、临时查询失败或其他客户端状态变化不得提前停止轮询，也不得影响后台标题生成。
- R6：新会话标题直接更新 zustand 乐观项，避免 `router.refresh()` 导致流式组件重挂；历史会话沿用现有刷新语义。
- R7：采用按 conversationId 隔离的定向短轮询；每 1 秒查询一次，只允许在标题完成或累计达到 1 分钟上限时停止。

## Acceptance Criteria

- [x] AC1：新会话首条消息发送后可以先显示截断标题；worker 写入最终标题后，ChatHeader 与 Sidebar 自动显示最终标题，无需刷新页面。
- [x] AC2：最终标题属于其他 conversationId 时，不得覆盖当前乐观会话标题。
- [x] AC3：标题任务失败或仍在重试时保留 fallback，聊天回答正常完成；轮询继续到标题完成或 1 分钟上限，且无未处理异常。
- [x] AC4：用户在标题生成期间手动改名时，自动标题不得覆盖人工标题，客户端最终显示人工标题。
- [x] AC5：查询未登录、会话不存在或不属于当前用户时，不泄露标题或任务状态。
- [x] AC6：针对标题状态查询、客户端状态收敛、停止条件和资源清理补充自动化测试。
- [x] AC7：正常完成时，从最终标题落库到页面显示的延迟不超过一个 1 秒轮询周期（不计浏览器后台定时器节流）。
- [x] AC8：轮询期间切换到其他会话或触发聊天组件重挂，原 conversationId 的轮询仍持续到标题完成或 1 分钟上限；不得串写其他会话标题。

## Out Of Scope

- 跨标签页、跨设备同步标题。
- 为其他后台任务建设通用实时事件平台。
- 修改标题生成模型、提示词、fallback 截断规则或 outbox 重试策略。
- 重构聊天流、会话列表或现有队列抽象。

## Technical Notes

- 已确认采用定向短轮询，不新增跨进程推送基础设施。
- 轮询读取数据库事实源，不改变标题 worker、outbox、队列恢复或聊天 SSE 生命周期。
- 1 分钟上限用于防止 provider/worker 长期异常时产生无限请求；超时后保留当前 fallback，后台 worker 与 outbox 仍独立继续，后续整页刷新仍可读取最终数据库标题。
