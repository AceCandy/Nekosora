# Design: 未提交改动收尾

## 1. 提交边界

### Batch A: 消息反馈与分支状态恢复

- DB：`message_feedback` schema 与新的顺序迁移，journal/snapshot 同步。
- Server：feedback model/action、branch 查询回填 feedback/toolCalls。
- Client：SSR DTO、ChatMessage 类型、store 乐观更新/回滚、版本切换保留、组件接线和 i18n。
- Spec：`hook-guidelines.md` 中 React 顶层导出兼容规则。

迁移修复原则：已发布 `0008_model_catalog_configured` 不改运行语义。使 `0008_snapshot` 与 0008 SQL 表达同一状态，再由 Drizzle 生成下一序号反馈迁移和 snapshot；禁止仅手改 journal 伪造链路。

验证不变式：`0008_model_catalog_configured.sql` 内容保持不变；新迁移 tag/文件使用下一序号 `0009_*`；journal idx 连续；0009 snapshot 的 `prevId` 指向修正后的 0008 snapshot `id`。

### Batch B: 分支上下文预算与压缩

- `/api/chat` 只纳入 `branchLeafPublicId` hunk。
- orchestrator 根据目录模型能力计算输入/输出预算，并从当前分支叶构建上下文。
- context assembler、compact 与 token trim 共同保证预算和系统消息保留。
- 修复不变式：`0 < inputBudget <= contextWindow`；不能表示为普通字符串的 system 消息仍保留在 dialogue。

### Batch C: Agent 多轮用量聚合

- `streamChat` 在被 Agent 外层调用时只回报步骤终态，不写步骤级最终 usage。
- `streamChatWithTools` 聚合 token、最早 TTFT、终轮路由快照并只写一次最终 usage/error。
- key/route attempt 失败日志仍逐次保留且不重复计入 metrics。
- 即使 `maxSteps=0` 或首步在回调前抛错，外层也必须写一条 `interrupted` 或 `failed` 终态。

无 step usage 时由 Agent 外层构造 fallback 终态参数：沿用 `opts` 中的 `runId`、user、model、source、taskKind 与外层耗时，token 统一为 0；provider/route/TTFT 留空，不伪造上游快照。`maxSteps=0` 映射 `interrupted`，捕获到异常映射 `failed`，最终仍只调用一次 `logUsage` / metrics。

## 2. 数据流与兼容

```text
SSR branch query -> feedback/toolCalls DTO -> zustand runtime -> ChatMessageItem
POST /api/chat -> branchLeaf -> context assembler -> compact/token trim -> stream
stream steps -> final usage callbacks -> agent aggregate -> one logUsage
```

- 反馈 API 继续对不存在、已删除、非 assistant、非属主消息统一拒绝，避免枚举。
- SSE payload 和消息树外部契约不变。
- 已提交的 P1-A runId 生命周期继续由 route 透传，不在 Batch C 重写。

## 3. 风险与回滚

- migration 是最高风险：先验证元数据链，再提交其他层；回滚代码时保留 expand-only 表。
- `branch.ts` 与 `ChatMessageItem.tsx` diff 较大，必须以 targeted tests 和 staged review 防止混入上下文 hunk。
- `stream.ts` 是共享核心，必须覆盖 success/failed/interrupted/maxSteps=0 和 metrics 唯一性。
- 每批独立 commit；任一批失败只取消该批暂存，不回滚其他工作树内容。
