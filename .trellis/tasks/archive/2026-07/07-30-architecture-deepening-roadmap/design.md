# Architecture Deepening Roadmap Design

## 1. Design Intent

本路线图不是一次性“重写全站”，而是把五段高复杂度控制流逐一收拢为深模块。每一阶段必须先建立可执行契约，再替换入口，最后删除旧编排；下一个阶段只能依赖前一阶段已经完成并验证的公开边界。

## 2. Baseline

Phase 0 已完成 `gateway-execution`：模型请求平面统一拥有 route/key retry、failover、commit、Abort、breaker、脱敏和 telemetry。后续任务只能消费其 safe outcome/event，不得把 Chat 消息事务、RAG lease 或 worker lifecycle 塞回 engine。

## 3. Target Architecture

### 3.1 Chat Completion Transaction Boundary

目标所有者：Chat run/completion coordinator。

拥有：模型事件归并、必要消息提交、run 终态、durable post-commit intent、finish/`[DONE]` 顺序和取消收敛。

不拥有：provider retry、Chat UI 状态、具体 memory/title worker 业务逻辑。

### 3.2 RAG File Processing State Machine

目标所有者：RAG processing coordinator + lease repository。

拥有：claim、DB-clock lease、heartbeat、阶段转换、fencing、chunk 原子替换、失败分类与 stale recovery。

不拥有：通用 queue 启停、文件上传 HTTP、embedding provider routing。

### 3.3 Worker / Queue Lifecycle

目标所有者：worker runtime/lifecycle module。

拥有：job definition 注册、queue startup、recovery scheduler ownership、handler failure propagation、active-operation drain、signal shutdown 和启动失败清理。

不拥有：RAG、memory、title 的领域状态机；这些通过稳定 job/recovery adapter 注册。

### 3.4 Model Catalog Sync Contract

目标所有者：catalog sync planner/normalizer。

拥有：上游数据解析、字段权威策略、能力升降、thinking map 校验、跨字段 invariant、原子 fallback 和 dry-run diff。

不拥有：在 UI/routing/provider 层复制模型能力；这些层继续消费 `model_catalog`。

### 3.5 Chat Composer State Coordinator

目标所有者：Composer selection reducer/coordinator。

拥有：card/KB 等相关选择的一致快照、乐观状态、持久化排队/合并、失败恢复和会话切换 fencing。

不拥有：Chat stream store、服务端完成事务或 Toolbar 展示布局。

## 4. Dependency Flow

```text
gateway-execution (done)
          |
          v
chat completion transaction ---- durable intents ----+
                                                      |
rag processing state machine ---- recovery adapter ---+--> worker/queue lifecycle

model catalog sync contract  (independent control plane)

chat completion contract ---> chat composer state coordinator
```

Phase 1 和 Phase 2 可以在技术上独立，但按顺序执行以避免两个高风险数据状态机同时重构。Phase 3 必须等待两者边界稳定。Phase 4 独立但延后，Phase 5 为较低优先级前端一致性收尾。

## 5. Cross-Task Invariants

- 只有明确的权威终态可以触发客户端/worker 的“完成”信号。
- Abort、lease loss、shutdown 都是独立终态，不得伪装成普通业务成功或 provider failure。
- DB 条件写与 fencing token 决定所有权；进程内布尔值只能做优化，不能作为跨实例事实源。
- Durable delivery 使用数据库事实/outbox；`console.error` 不能代表可恢复交付状态。
- Domain module 抛出的错误必须可分类且已脱敏；runtime/lifecycle 层不得记录完整 payload。
- 所有迁移只允许 forward migration，journal/snapshot 同步，且必须明确数据影响范围。

## 6. Integration Gates

每个 child 的完成 gate：

1. characterization tests 锁定现有外部行为。
2. 新 module contract tests 先通过。
3. 生产入口迁移后删除旧编排。
4. 定向 tests、lint、typecheck、必要的 PostgreSQL tests/build 全部通过。
5. 规格同步、独立复核、提交并归档。

父任务最终 gate：验证 Chat → durable job → worker → RAG/title/memory 的完整数据流；验证 catalog → UI/routing/request translation；确认没有临时双写、双状态机或重复能力判断。

## 7. Rollback Strategy

- 每个 child 单独提交和归档，回滚只针对当前 child，不跨阶段撤销已验证模块。
- 数据结构变更使用 forward fix；除非该 child 另行获批，不清空业务数据。
- 新旧入口并存只允许存在于单个 child 的迁移阶段，完成前必须删除旧入口。
- 若某 child 暴露上游设计缺陷，回到该 child 的 planning，不用父任务掩盖未决问题。
