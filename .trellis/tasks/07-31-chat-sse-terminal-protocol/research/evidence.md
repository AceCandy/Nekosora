# Chat SSE Terminal Protocol Evidence

## Current Server Behavior

- `src/lib/chat/completion-coordinator.ts` 返回六种 `ChatCompletionOutcomeKind`，数据库已可靠区分 committed success/failed/interrupted 与 start/persistence failure。
- `src/app/api/chat/route.ts` 只在 `finish` encoder 内写 `[DONE]`；failed/interrupted 只依赖 error 或 stream close。
- cancel 通过共享 AbortController 与 `safeEnqueue` 抑制客户端断开后的写入，本任务应保留该边界。

## Current Client Behavior

- `src/features/chat/model/sse.ts` 在 `[DONE]` 直接 return，reader EOF 也正常 break，没有成功/失败结果。
- `src/features/chat/store/chatStreamStore.ts` 的 onError 只追加文本；continueGeneration 在 parser 正常返回后无条件写 success。
- `src/features/chat/model/types.ts` 与 PostgreSQL `message_status` 都以 success/interrupted 表达完整性；`completion-repository.ts` 将 failed/interrupted assistant 都持久化为 interrupted。

## Design Consequence

- wire 必须新增独立 terminal，而不是给所有错误简单补 `[DONE]`。
- route 应复用 coordinator outcome，不创建第二套终态推断。
- parser 必须返回 terminal 并拒绝缺失终态的 EOF；Store 只在 success terminal 时写 success。
- 无需新增数据库 failed message 状态；run/terminal 表达失败分类，message status 保持继续生成语义。
- terminal wire 类型应由 `src/lib/chat/sse-contract.ts` 唯一拥有；route 用穷尽映射，parser 用共享 guard，避免跨层字符串联合漂移。

## Final Implementation Evidence

- route 对六种 `ChatCompletionOutcomeKind` 使用编译期穷尽映射；finish 只编码 metadata，await outcome 后才编码 terminal + DONE，所有写仍经过 Abort-aware `safeEnqueue`。
- parser 返回 terminal status，拒绝缺 terminal 的 DONE、success 缺 finish、矛盾/重复/非法 terminal、terminal 后业务帧和 EOF 缺 DONE，并处理分块及无尾换行的最终帧。
- send、regenerate、editAndResend、continueGeneration 统一把 success 映射为 message success，failed/interrupted/协议异常映射为 interrupted；error frame 与 catch 最多追加一份错误。
- 完整 diff 复核期间发现并修复三条非 send 路径缺失 onError、send 双重错误和 catch 不稳定索引问题。
- lint、typecheck、最终 76/76 定向测试、1010 passed / 17 skipped 全量 Vitest 和 production build 均通过。
