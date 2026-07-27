# 修复会话标题实时更新：实施计划

## 1. 服务端标题状态查询

- 在 `src/lib/conversation-title/service.ts` 增加按 `userId + conversationId` 读取标题与当前 outbox 的状态查询。
- 复用现有 `canReplaceTitle` 语义判断 pending，避免人工改名规则漂移。
- 在 `src/features/chat/actions/conversations.ts` 增加经 `requireSession` 鉴权的薄 Server Action。
- 在 service/action 对应测试中覆盖 pending、成功 settled、人工改名、missing/非属主。

验证：针对性运行标题 service 与 conversations action 测试。

## 2. 新会话有界轮询与 store 收敛

- 在 `src/features/chat/store/chatStreamStore.ts` 增加按 conversationId 隔离、独立于组件生命周期的模块内单用途轮询逻辑。
- 仅在新会话的 `/api/chat` 成功响应后启动；1 秒串行轮询，最多持续 1 分钟。
- 仅当 `optimisticConversation.id` 匹配时写入标题；会话变化不停止轮询，也不得串写其他会话。
- 查询异常、无权或暂时不存在不进入聊天错误内容，不中断 SSE 回答，也不提前停止；只在 settled 或 1 分钟上限停止。
- 更新与后台 worker SSE 推送有关的误导注释，保留现有兼容解析分支。
- 在 `chatStreamStore.test.ts` 使用 fake timers/mock action 覆盖最终标题更新、ID 隔离、切换后继续、异常重试和仅有的两个停止条件。

验证：针对性运行 chat store 测试，并检查测试结束无残留 timer/promise。

## 3. 规范同步与质量复核

- 更新 `.trellis/spec/frontend/state-management.md`，将后台标题完成通知的实际契约改为“有界短轮询 + store 覆盖”，说明 SSE 兼容路径。
- 运行相关 Vitest 文件。
- 因改动跨 Server Action、DB 查询与客户端 store，申请运行 `pnpm typecheck`；按项目 Java 补充规则不执行无关全量编译。
- 使用独立复核检查鉴权、竞态、timer 清理、outbox 语义未变和 diff 范围。

## 风险文件与回滚点

- `src/lib/conversation-title/service.ts`：只增加只读查询，不改生成事务。
- `src/features/chat/actions/conversations.ts`：只增加鉴权包装，不改现有会话 CRUD。
- `src/features/chat/store/chatStreamStore.ts`：轮询必须与主 SSE 错误路径隔离。
- 如任一层验证失败，回滚本任务新增查询/轮询与测试；无数据库迁移需要撤销。
