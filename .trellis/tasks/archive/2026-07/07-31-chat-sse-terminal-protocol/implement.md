# Chat SSE Terminal Protocol Implementation Plan

## Execution Rule

只在用户审阅本 planning summary 并再次明确批准后执行。先用测试锁定新协议，再修改 route/parser/Store；不引入数据库变更或新旧双轨。

## Phase 0: Baseline And Red Tests

- [x] 运行 route、SSE parser、Store 定向基线。
- [x] 在 `route.test.ts` 写六种 outcome、terminal tail 与 Abort 零写测试，替换“失败不补 DONE”的旧契约。
- [x] 在 `sse.test.ts` 写 terminal result、DONE 缺 terminal、success 缺 finish、EOF 缺 DONE、重复/非法 terminal、terminal 后业务帧与分块尾帧测试。
- [x] 在 `chatStreamStore.test.ts` 写 send、regenerate、editAndResend、continueGeneration 四路径 success/failed/interrupted 状态测试。
- Gate：新测试在旧实现上按预期失败，既有 cancel 行为仍有 characterization。
- Rollback point：仅测试。

## Phase 1: Route Terminal Adapter

- [x] 新增 `src/lib/chat/sse-contract.ts`，作为 terminal status/event/guard 的唯一共享 owner，避免 route/parser 重复字符串联合。
- [x] route 对 `ChatCompletionOutcomeKind` 做穷尽映射，await coordinator 后发送 terminal + `[DONE]`。
- [x] 从 finish encoder 移除内联 `[DONE]`，保持 finish 仅承载 success metadata。
- [x] 保持 request Abort/reader cancel 后 `safeEnqueue` 零写。
- Verify：route success/failed/interrupted/start/persistence/cancel 测试。
- Rollback point：route 与共享类型单元可回滚，无数据影响。

## Phase 2: Strict Parser Contract

- [x] `consumeChatSSE` 返回 terminal status，校验 terminal status、finish-before-success 和 terminal-before-DONE。
- [x] EOF 未收到合法 DONE 时抛协议错误；未知事件保持忽略，畸形 JSON 不能推进终态。
- [x] EOF 前处理 decoder flush 与残余 buffer；覆盖分块 frame、无尾换行、DONE 后不等 EOF、terminal 后业务帧、重复/非法 terminal 和 Abort 传播。
- Verify：`src/features/chat/model/sse.test.ts`。
- Rollback point：parser 与 route 同步回滚。

## Phase 3: Store State Convergence

- [x] send、regenerate、editAndResend、continueGeneration 统一消费 terminal result，并按各自稳定 assistant index 更新目标消息。
- [x] success 写 `status=success`；failed/interrupted 及协议异常写 `status=interrupted`。
- [x] 保留 error 文案只追加一次、delta 先 flush、stopGeneration 即时 interrupted 和 run metadata success-only 语义。
- [x] 删除 continueGeneration 的无条件 success 收敛。
- Verify：Store 四条调用路径的 success/failed/interrupted/Abort 回归。
- Rollback point：Store 与 parser/route 同步回滚。

## Phase 4: Cross-Layer Verification

- [x] 定向测试：

```bash
pnpm test -- src/app/api/chat/route.test.ts \
  src/features/chat/model/sse.test.ts \
  src/features/chat/store/chatStreamStore.test.ts \
  src/lib/chat/completion-coordinator.test.ts
```

- [x] 运行 `pnpm lint`、`pnpm typecheck`、全量 `pnpm test` 和 `pnpm build`。
- [x] 独立复核 outcome 映射穷尽性、Abort 后零写、EOF gate、错误文本顺序与 `/v1/*` 零改动。
- [x] 更新 backend chat-run/error 规格与 frontend state-management 规格。
- Gate：定向、全量质量门和独立复核全部通过。

## Risk Register

| Risk | Mitigation / Gate |
| --- | --- |
| 新 parser 与旧内部服务端不兼容 | 项目未上线；route/parser/Store 同发布单元切换；旧前端可忽略 terminal |
| failed/interrupted 被错误映射为 success | outcome 穷尽 switch + route/parser/Store 三层矩阵测试 |
| client Abort 后补写 terminal | 复用 safeEnqueue signal gate，并保留 reader cancel 测试 |
| error 文案重复或落在残留 delta 前 | terminal 不携带文案；onError/catch 前统一 flush；Store 回归测试 |
| 扩大为数据库状态迁移 | 明确不改 schema；message status 保持恢复语义，run 保持终态事实源 |

## Pre-Start Review Checklist

- [x] `prd.md`、`design.md`、`implement.md` 和 context manifests 通过 Trellis validate。
- [x] 用户确认 terminal + DONE 新内部协议、严格 EOF gate、无数据库迁移和 `/v1/*` 零改动。
- [x] 任务在 planning summary 获得明确批准后才执行 `task.py start`。

## Execution Results

- Baseline：改动前全量 Vitest 981 passed / 17 skipped。
- Red 1：route/parser/Store 新契约产生 29 个预期失败；Green 1 为 66/66。
- Red 2：矛盾 finish/terminal 产生 1 个预期失败；修复后通过。
- 独立完整 diff 复核发现 regenerate/edit/continue 缺少 `onError`、send error 后协议异常重复追加、regenerate/edit catch 使用不稳定末消息索引；新增 7 个预期失败后修复。
- 最终定向测试：4 个文件 76/76；lint、typecheck 通过。
- 最终全量 Vitest：117 个文件通过、2 个跳过，1010 个用例通过、17 个跳过。
- Production build 通过，19 个静态页面生成完成。
- 未修改数据库 schema、completion coordinator、Gateway 或公开 `/v1/*` 文件；未启动本地服务。
