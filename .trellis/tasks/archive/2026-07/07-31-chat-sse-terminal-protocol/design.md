# Chat SSE Terminal Protocol Design

## 1. Problem Boundary

数据库 completion coordinator 已经可靠收敛 run 与 assistant，但 WebChat wire 只有成功 `finish/[DONE]`，失败/中断依赖 error 或 EOF。前端 parser 又把 EOF 当正常返回，导致传输结束被误当成业务完成。

本任务只补齐 `coordinator outcome -> route wire -> parser result -> Store message status` 这一条跨层链路。数据库事务、Gateway 和公开 API 保持不变。

## 2. Wire Contract

新增 `src/lib/chat/sse-contract.ts` 作为 route 与 client parser 共用的唯一 wire 类型 owner，导出 terminal status、terminal event 和运行时 status guard：

```ts
type ChatTerminalStatus = "success" | "failed" | "interrupted";

type ChatTerminalEvent = {
  type: "terminal";
  status: ChatTerminalStatus;
};
```

route 使用 `Record<ChatCompletionOutcomeKind, ChatTerminalStatus>` 声明穷尽 outcome 映射；parser 使用共享 guard 校验未知 JSON，禁止两层各自维护字符串联合。

固定序列：

```text
success:      ... -> finish(metadata) -> terminal(success) -> [DONE]
failed:       ... -> error            -> terminal(failed) -> [DONE]
interrupted:  ... -> error            -> terminal(interrupted) -> [DONE]
client abort: ... -> transport cancelled; no terminal/DONE write
```

`finish` 仍只表示 committed success 的 metadata；terminal 表示 completion 的业务 outcome；`[DONE]` 只证明完整 wire tail 已送达。三者职责不得合并。

## 3. Server Ownership

`executeChatCompletion` 继续返回现有 `ChatCompletionOutcome`。route 在 await 返回后用穷尽 switch 映射：

| Outcome kind | Terminal status |
| --- | --- |
| `committed_success` | `success` |
| `start_failed` / `committed_failed` / `persistence_failed` | `failed` |
| `cancelled_before_start` / `committed_interrupted` | `interrupted` |

route 的 `finish` encoder 不再内联发送 `[DONE]`。只有 coordinator 返回后，adapter 才发送 terminal 和紧随其后的 `[DONE]`。`safeEnqueue` 与现有 AbortSignal 继续保证取消后零写；映射不得读取 assistant 文本或 error 帧来猜状态。

## 4. Parser State Machine

`consumeChatSSE` 返回 `Promise<ChatTerminalStatus>`，内部维护：

- `finishSeen`：只有合法 finish metadata 才置 true。
- `terminalStatus`：只接受三个受支持值；重复 terminal 或终态后业务帧视为协议错误。
- `[DONE]`：必须已经有 terminal；success 还必须有 finish。满足后返回 terminal status。
- EOF：在没有合法 `[DONE]` 时统一抛协议错误，不能静默返回。
- decoder EOF 时先 flush 并检查残余 buffer；分块或末帧无换行不能被静默丢弃。

未知 event type 保持忽略以支持扩展；JSON 解析失败保持忽略，但因此不能更新 terminal latch。重复 terminal、terminal 后继续出现业务帧、非法 status 都抛协议错误。Abort 导致的 reader 异常原样抛出，由现有 `handleStreamError` 识别。

## 5. Store Mapping

四条流式动作必须保存 parser 返回值，并经一个局部 helper 更新目标 assistant：

```text
terminal success              -> message.status = success
terminal failed/interrupted   -> message.status = interrupted
Abort catch + stopGeneration  -> message.status = interrupted
protocol error/EOF            -> catch 追加网络错误并标记 interrupted
```

`onError` 仍负责在 flush 后追加服务端错误文案。terminal 本身不追加第二份文案。continueGeneration 删除当前无条件 success 写法，仅在返回 success 时收敛 success。

message status 的语义保持“内容是否完整、是否可继续”，不是 run 失败分类；run status 仍是历史终态事实源。因此不扩展数据库 enum，也不制造刷新前后不一致的临时 `failed` message 状态。

## 6. Compatibility And Rollback

- 旧 WebChat parser 会忽略新 terminal，并继续在 `[DONE]` 返回，因此新服务端对旧前端兼容。
- 新 parser 不接受旧服务端缺 terminal 的 tail。项目尚未上线，选择严格切换，不增加长期双协议分支。
- `/v1/*` 不使用该 parser/route，不受影响。
- route、parser、Store 必须在一个发布单元中回滚；无数据迁移或数据回滚步骤。

## 7. Verification Matrix

| Case | Route tail | Parser result | Message status |
| --- | --- | --- | --- |
| committed success | finish, terminal success, DONE | success | success |
| committed failed | error, terminal failed, DONE | failed | interrupted |
| start/persistence failed | error, terminal failed, DONE | failed | interrupted |
| natural EOF outcome | error, terminal interrupted, DONE | interrupted | interrupted |
| client Abort | no later write | AbortError | interrupted by local stop |
| DONE without terminal | invalid | protocol error | interrupted + error text |
| success without finish | invalid | protocol error | interrupted + error text |
| network EOF before DONE | truncated | protocol error | interrupted + error text |

## 8. Spec Updates

实现完成后同步：

- `.trellis/spec/backend/chat-run-metadata.md`：把失败/中断 `error + EOF` 改为显式 terminal + DONE，并保留 cancel 零写。
- `.trellis/spec/backend/error-handling.md`：记录 terminal 不携带原始错误、EOF 缺终态属于协议异常。
- `.trellis/spec/frontend/state-management.md`：记录 parser terminal gate 和四条 Store 状态映射。
