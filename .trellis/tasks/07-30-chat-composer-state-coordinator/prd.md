# Chat Composer 状态协调

## Goal

为 Chat Composer 建立单一 selection transition/persistence coordinator，使指令卡、知识库及相关会话级生成选择以一致快照更新和持久化，消除快速交错操作、异步返回乱序和会话切换造成的旧状态覆盖。

## Background

- `ChatComposer.tsx` 将 card IDs、KB IDs、web search、output mode、render style 和 per-model reasoning 分散在多个 state/updater。
- `persistComposerState(nextCards, nextKbs)` 从一个 updater 计算新值，却从 render closure 读取另一个字段。
- 多个 Server Action 通过独立 transitions fire-and-forget，缺少统一版本/fencing 和失败恢复。

## Requirements

- R1. 相关 Composer 选择由一个显式 state/reducer 表达；发送请求读取一个原子 snapshot。
- R2. Card/KB 快速交错 toggle 必须基于同一最新 state 生成持久化 payload，不读取过期闭包字段。
- R3. 持久化必须串行、合并或带版本 fencing，旧响应不能覆盖更新选择。
- R4. 会话创建/切换时旧会话 pending 写不能落到新会话；新会话应从当前选择建立明确初始状态。
- R5. 乐观 UI 失败后必须有确定策略：回滚、重取或保持 dirty 并重试，不能只 console 后永久漂移。
- R6. Per-model reasoning 继续按 `conversationId + modelId` 保存，不能退化为会话全局单值。
- R7. Toolbar/Composer 的现有交互、键盘行为、移动端布局和发送 payload 保持不变。

## Acceptance Criteria

- [ ] card A toggle 与 KB B toggle 在任意交错/延迟顺序下，服务端最终为 UI 最后可见组合。
- [ ] 快速开关同一选项不会被旧请求回写覆盖。
- [ ] 会话 A 的 pending persistence 在切到 B 后不能修改 B。
- [ ] 新会话创建前后的选择有明确继承规则并有测试。
- [ ] 持久化失败可观察并恢复，UI 与服务端最终收敛。
- [ ] send/ask 使用同一 coordinator snapshot；reasoning 仍按具体 modelId clamp/persist。
- [ ] reducer/coordinator tests 与组件交互 tests 覆盖交错操作和失败路径。

## Dependencies

- 路线图要求 `07-30-chat-completion-transaction-boundary` 先稳定 Chat 业务完成边界。

## Out Of Scope

- Chat 视觉重设计、Toolbar 信息架构或新生成选项。
- 服务端消息/run/SSE 事务、Gateway execution 或 RAG 状态机。
- 将所有 Chat stream store 状态重写为新状态库。

## Planning Gate

实现前必须确认新会话选择继承和持久化失败 UX 两项产品语义，补交互 characterization tests，并形成 coordinator 接口与逐步迁移计划。
