# 段A上下文准备并行化

## Goal

`prepareChatContext`(`src/lib/chat/orchestrator.ts`)中无数据依赖的耗时步改为并行执行(`Promise.all` / `allSettled`),降低 `/api/chat` 首字延迟。**保持兜底行为与 trace 输出不变。**

## Background

`prepareChatContext` 当前串行 await,耗时累加:
1. 知识库 fileIds 合并 + vision 分离 + RAG 上下文构建
2. `searchWeb(userContent)` —— 外部 API,1-3s
3. `getMemories(userId)` + `recallMemories(userId, userContent)` —— embedding + 向量检索,100ms-1s
4. 已有消息查询 + `maybeCompact` —— 可能触发 LLM 摘要,秒级
5. output mode / template / instruction cards 查询

其中 2/3/4/5 大多无数据依赖,串行执行把首字延迟无谓累加。

## Requirements

- 无依赖的耗时步改并行执行
- 保留每个步骤原有的兜底行为(搜索失败 / 召回失败 / 压缩失败均降级,不阻断)
- `trace`(process_trace)输出与串行版**逐字段一致**
- vision 校验失败仍提前返回 400
- `assembleContext` 仍最后执行,等齐全部上游输入
- 不改变 `prepareChatContext` 的对外签名与返回结构

## Constraints

- 仅动 `prepareChatContext` 内部执行顺序,不改 IRRequest 产出逻辑
- 有数据依赖的步骤保持顺序:如 `maybeCompact` 依赖 `existingMsgs` 查询;`searchContext` 依赖 `searchBundle`;RAG 链(fileIds 合并 → vision 分离 → buildMessagesWithFileContext)内部有序
- 不改变 RAG / 搜索 / 记忆 / 压缩的实际产出内容

## Acceptance Criteria

- [ ] `searchWeb` / `recallMemories` / `getMemories` / 已有消息查询(+`maybeCompact`) / output mode / template / cards 中无依赖者已并行
- [ ] 各步兜底行为不变(联网搜索失败仍降级、召回失败仍不注入 project、压缩失败仍跳过)
- [ ] trace 内容与改动前一致(可用同一输入对比 `buildTrace` 输出快照)
- [ ] vision 不支持图片输入仍返回 400
- [ ] `pnpm typecheck` / `pnpm lint` 通过;现有 `reasoning.test.ts` / `routing.test.ts` 等不回归
- [ ] 必要时补 `prepareChatContext` 行为测试(验证并行后兜底与 trace 一致)

## Notes

- 复杂任务,需 `design.md` 给出依赖图 + 并行分组 + allSettled 兜底策略,`implement.md` 给执行清单。
- 实现时务必先画清各步骤输入/输出依赖,避免把有依赖的步骤误并行(会导致结果错乱)。
