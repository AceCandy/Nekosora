# 修复聊天记忆超时与流光动画

## Goal

避免长期记忆查询拖住核心聊天，并让聊天过程状态的流光重新保持清晰、连续。

## Background

- Chat 在 `packages/core/src/lib/chat/orchestrator.ts` 中并行准备记忆、压缩、附件等上下文；记忆分支当前会等待 `getMemories` 与 `recallMemories` 全部结束。
- 记忆召回会经过 mem0、PostgreSQL/pgvector，并可能调用 Embedding 接口，不是纯本地内存查询；当前底层调用缺少覆盖整条记忆准备链的等待上限。
- 项目已有 `packages/core/src/lib/best-effort.ts`，提供固定 5 秒、会清理定时器的 best-effort 超时机制。
- `apps/web/src/app/globals.css` 中的现有流光周期为 4 秒，只在前 45% 移动，后 55% 停在末尾；高光带较窄。

## Requirements

- R1：单轮 Chat 的 `getMemories + recallMemories` 合计最多等待 5 秒；任一步骤未在整体时限内完成时，本轮使用空记忆继续准备主模型请求。
- R2：记忆正常完成时维持现有注入行为和 `completed` 过程状态；超时时将 memory 过程状态收敛为 `skipped`，不得被底层任务的迟到结果重新覆盖。
- R3：复用项目现有 5 秒 best-effort 超时机制，不新增配置项、依赖或重复超时工具。
- R4：聊天过程状态流光使用更宽的高光带，完整扫描周期保持 2 秒，匀速从一端移动到另一端，末尾不额外停顿。
- R5：循环复位发生在文字范围外，避免肉眼可见的反向跳动；继续遵守现有 `prefers-reduced-motion` 全局兜底。

## Acceptance Criteria

- [x] AC1：当记忆 Promise 永不结束时，`prepareChatContext` 在 5 秒超时后继续返回，不等待记忆底层任务完成。
- [x] AC2：超时结果不向 `assembleContext` 注入任何长期记忆，memory trace 最终为 `skipped`；迟到完成不会再写成 `completed`。
- [x] AC3：记忆在 5 秒内完成时，原有记忆数量、注入内容和 `completed` trace 保持不变。
- [x] AC4：流光关键帧从 0% 持续移动到 100%，动画声明为 `2s linear infinite`，高光蒙版明显宽于现状。
- [x] AC5：定向后端测试通过，并确认现有减弱动效规则仍覆盖流光伪元素。

## Out of Scope

- Gateway 连接池、治理租约及 PostgreSQL `53300` 问题。
- 修改 mem0、pgvector、Embedding 客户端或其连接/请求超时。
- 为记忆超时增加用户可配置项、重试、告警或新的 UI 文案。

## Deferred Risk

- 现有记忆 API 不接收取消信号，因此 5 秒后 Chat 会停止等待，但底层未完成 Promise 可能继续运行；只有观察到持续资源占用时，再单独为 mem0/Embedding 补可取消能力。

## Notes

- 本任务不改共享事件结构或公共接口，按轻量任务保留 PRD-only。
