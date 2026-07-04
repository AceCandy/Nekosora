# Chat 重生成切换模型

## Goal

多模型并排的轻量版：重新生成一条 assistant 消息时，允许切换到其他模型，产生新版本分支用于对比。复用现有版本分支机制，不重构 chatStreamStore。

## Requirements

- assistant 消息的「重新生成」入口增加模型选择能力（hover 出小型模型选择，或重生成时弹模型列表）
- 选择不同模型重生成后，产生新版本分支（与现有 retryFromMessage 同构），不覆盖原版本
- 版本切换器显示每个版本使用的模型标识（让用户能区分「哪个模型答的」）
- 选择同一模型则等价于现有重新生成
- 重生成过程复用现有 SSE 流式与停止能力

## Acceptance Criteria

- [ ] 重新生成时可选其他模型
- [ ] 选不同模型生成后，版本切换器出现新版本
- [ ] 每个版本可见其使用的模型
- [ ] 版本间可切换查看
- [ ] 选同模型行为与现有重新生成一致
- [ ] 不破坏现有重新生成、编辑、版本切换

## Constraints

- 不重构 chatStreamStore 的单 runtime 模型
- 复用 `retryFromMessage` 分支机制，扩展携带 model 参数
- 版本元数据需记录使用的 model（design 阶段确认存哪）
- 依赖 `chat-message-branch-ops` 的分支基础

## Notes

- 参考 kivio `MultiModelSelector.tsx`、AQBot `BranchComparePanel.tsx`（分支对比面板，本任务不做到对比面板，仅版本切换）
- 本任务 PRD-only 即可（实现细节落在 branch 基础上）
