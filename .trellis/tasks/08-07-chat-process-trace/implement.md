# 统一聊天过程轨迹：实施计划

## Success Strategy

先锁定契约和 reducer，再接后端事实，最后替换展示。任何阶段都不得以 UI 推断代替后端状态，也不得破坏现有 run/terminal/Abort/Web Search 契约。

## Phase 0. Baseline And Contract

- [ ] 保存当前相关测试基线；确认工作树已有统一面板改动并在其上继续，不覆盖用户改动。
- [ ] 在 `packages/contracts/src/chat.ts` 增加 V1 phase/step/event/snapshot 类型、允许的 safe data 和守卫。
- [ ] 扩展 `packages/db/src/types.ts` 的 `ProcessTrace`，只增加可选 `process` 快照并保持旧 JSON 兼容。
- [ ] 在 Core SSE contract 中复用共享类型，禁止 route/frontend 重复定义字段联合。
- [ ] 新增契约测试：有效事件、非法 version/status/seq、敏感字段不在允许 payload 中。

验证：contracts/core/db typecheck；旧 `ProcessTrace` fixture 仍能编译和读取。

## Phase 1. Pure Recorder And Reducer

- [ ] 新建最小 `ChatProcessRecorder`：分配 seq、按 stepId upsert、终态锁定、生成安全 snapshot。
- [ ] recorder 不依赖 HTTP、React 或数据库；只接收 clock/emit 以便确定性测试。
- [ ] 新建前端纯 reducer；live event 与历史 snapshot 共用相同 normalize/upsert 规则。
- [ ] 定义固定状态迁移表，非法 terminal 后更新、倒序/重复 seq、跨 run 事件必须被拒绝。
- [ ] 加隐私 allowlist 测试，使用 sentinel 覆盖 Prompt、memory、tool args/result 和 raw error。
- [ ] snapshot 按 run 分组，reducer 以 `(runId, stepId)` 标识步骤，并按 run 保存 lastSeq。

验证：recorder/reducer 单测；事件 replay 两次结果相同；并行 step 更新保持首次顺序。

## Phase 2. Backend Preparation Lifecycle

- [ ] 把 `/api/chat` 明确拆成 preflight 与 run-owned execution；保持现有 4xx、user 消息事务和稳定 IDs。
- [ ] 让 coordinator 通过惰性 `prepare(signal, recorder)` 在 startRunStrict/heartbeat 后拥有 `prepareChatContext`、模型流和 completion persistence。
- [ ] 给 orchestrator 注入 recorder；对附件/RAG、记忆、压缩、Prompt 规划建立稳定 steps。
- [ ] 保留阶段 2 `Promise.all`；使用 stepId 而不是串行 await 控制显示顺序。
- [ ] prepare failed/interrupted 复用唯一 terminal latch，并在不调用模型的情况下持久化正确 run/message 状态和快照。
- [ ] trace 发射失败仅记录安全内部告警并回退，不中止可正常生成的回答。
- [ ] 把 prepare 中仍可能返回 4xx 的能力/输入校验全部前移；流内 prepare 不返回 HTTP `Response`。

关键测试：

- [ ] preflight 失败仍是 HTTP 错误且零模型调用。
- [ ] strict start 失败零 prepare/模型调用、无伪造持久 trace，optimistic UI 正确失败。
- [ ] started/preparing 早于任何模型调用和正文。
- [ ] RAG/记忆降级、模板/卡硬失败、Abort during prepare。
- [ ] heartbeat 在 prepare 阶段有效，terminal/commit 前停止。
- [ ] finish/error iterator settlement 和现有 run metadata 测试全部保持。

## Phase 3. Reasoning, Tool And Search Projection

- [ ] 第一个 non-empty text delta 前发 `phase=answering`；空 delta 不触发。
- [ ] reasoning 仅发步骤 lifecycle，正文 reasoning delta 沿用现有通道，不产生双倍高频事件。
- [ ] tool-call/result 以 toolCallId 更新同一步；并行 Web Search 不按名称或数组位置归并。
- [ ] search_started/completed/failed 的 backend、attempts、citations 与 trace step 保持同源。
- [ ] continuation 合并旧 process snapshot 和 `webSearch.calls`，不得覆盖旧来源。
- [ ] continuation 追加独立 run snapshot；两个 continue run 的 seq/stepId 不覆盖。
- [ ] 保持 gateway 的 response-commit/failover 逻辑，不在 Chat coordinator 添加 route retry。

关键测试：首正文门控、同名并发工具、搜索失败后成功、正文前工具循环、正文后工具更新、continue additive trace。

## Phase 4. SSE And Store Integration

- [ ] `model/sse.ts` 在单一边界解码 `trace`，保留旧事件和严格 terminal/DONE 校验。
- [ ] `chatStreamStore` 为每个 conversation/run 保存 process runtime，并用一个 handler 覆盖 send/regenerate/edit/continue。
- [ ] optimistic assistant 立即进入 preparing；服务端 runId 到达后接管。
- [ ] error/Abort 前先 flush 正文/reasoning buffer，再终结 process state，防止错误插入正文中间。
- [ ] finish/terminal 后冻结 snapshot；terminal 后 trace 事件视为协议错误。
- [ ] version switch/branch change 使用目标消息快照全量替换，清理活动 run 的临时状态。
- [ ] 顶层 phase 第一次 answering 后不回退；正文后的 tool/search 只更新步骤与摘要。

关键测试：四条生成动作状态一致；duplicate/out-of-order/cross-run；错误和中断保留部分内容；后台 tab delta flush；旧服务端兼容。

## Phase 5. History Projection

- [ ] `getVisibleBranch` 和 chat page 投影 `processTrace.process`，继续合并 tool_calls 与 Web Search details。
- [ ] 旧历史由统一 compatibility projector 派生 completed/interrupted，不在组件里散落判断。
- [ ] sibling、continue、regenerate、edit 和 version switch 按自己的 assistant/run 恢复。
- [ ] public share 保持不暴露 run metadata/process internals，除非另有产品需求和授权设计。

关键测试：数据库 JSON round-trip、刷新恢复、旧 fixture、分支/版本隔离、continue 累加、公开分享不泄露。

## Phase 6. Unified UI

- [ ] 将 `MessageProcessTrace` 改为接收规范化 snapshot/runtime phase，并通过纯投影生成用户语义研究阶段。
- [ ] 外层默认只显示当前/终态摘要；详情使用轻量时间线，隐藏 Prompt、reasoning 正文、工具参数与 provider 调试路径。
- [ ] 来源作为时间线底部的独立 disclosure；运行转终态自动收起一次，终态后允许用户手动展开。
- [ ] completed/failed/interrupted 使用不同文本和图标；不以颜色作为唯一信号。
- [ ] i18n 同步 zh-CN/en，后端不发送展示文案。
- [ ] 使用现有 token、语义字号、Lucide 图标、`touch-target`、focus-visible 和全局 reduced-motion。
- [ ] 调整 ChatMessageList 空 assistant/滚动条件，把 process-only 占位视为有效流式内容。

组件测试：准备空态、各 phase、自动折叠一次、手动 override、长 query/URL、来源链接、键盘 disclosure、无 trace fallback。

## Phase 7. Independent Review And Release Gate

- [ ] 独立复核事件事实来源、状态迁移、terminal 顺序、失败降级和隐私边界。
- [ ] 搜索所有 `processTrace`、SSE handler、四条生成动作和独立 Web Search UI，确认无遗漏/重复投影。
- [ ] 检查所有新增事件只由共享 contract/decoder/reducer读取，无局部 `as { field?: ... }` 契约复制。
- [ ] 检查 changed lines 均可追溯到本 PRD；删除本次改动产生的 orphan props、i18n key、组件和 imports。
- [ ] 核对安全指标只有耗时/计数/终态，不含高基数或敏感 payload。

命令验证：

```bash
pnpm check
pnpm test
pnpm --filter @nekusora/contracts typecheck
pnpm --filter @nekusora/core typecheck
pnpm --filter @nekusora/db typecheck
pnpm build
git diff --check
```

浏览器验证：

- [ ] 登录态真实 Chat，普通回答、reasoning、MCP、Web Search、附件/RAG、失败、停止、continue。
- [ ] 320/390/768/1280px，亮/暗主题，无重叠、横向溢出或正文/输入区跳动。
- [ ] 键盘 Tab/Enter/Space、screen-reader 短摘要、coarse pointer 44px。
- [ ] reduced motion 下无 spinner/过渡持续动画。
- [ ] 首正文前面板可见，首正文到达后只自动收起一次，来源与正文引用一致。
- [ ] 调试服务在验证完成后关闭。

## Rollback Points

1. Contract/DB JSON 字段为 additive，可由旧代码忽略。
2. 后端先保留旧 tool/search/reasoning 事件；新 trace 出错可回退旧投影。
3. UI 切换前保持当前组件测试基线；若新 reducer 有问题，可只回滚 UI 而不删除持久快照。
4. 不新增表/依赖，数据库回滚不需要 destructive migration。

## Deferred Follow-up

当产品确认生成需要在客户端断开后继续时，单独规划后台 run + event broker + `afterSeq` replay。不要在本任务中加入 Redis Stream、通用事件表或隐藏 feature flag 分支。
