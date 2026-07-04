# Chat 模型参数调节

## Goal

让用户在会话内调节 temperature / topP / maxTokens，会话级持久化，后端 chat 接口实际应用。属前后端联动任务。

## Requirements

- toolbar 新增「参数」picker（与现有模型/输出方式 picker 同构），可展开调节三个参数：
  - temperature（0–2，步进 0.1）
  - topP（0–1，步进 0.05）
  - maxTokens（按当前模型上限动态约束，步进可调）
- 参数会话级持久化：写入 `composerState`，切会话/刷新后保留
- 参数为空/未设置时使用模型默认（不强制传值）
- 后端 chat 接口接收并下发给 model provider（Vercel AI SDK 的 `temperature` / `topP` / `maxTokens`）
- 提供「重置默认」一键清空自定义值
- 参数变更对下一次发送生效（不影响正在进行的流）

## Acceptance Criteria

- [ ] toolbar 可展开参数面板，三个参数可调
- [ ] 调整后发送消息，后端实际收到并应用（可在响应或日志验证）
- [ ] 切换会话再切回，参数保留
- [ ] 「重置默认」清空自定义值
- [ ] maxTokens 不超过当前模型上限
- [ ] 现有 chat / 流式 / 工具调用不受影响

## Constraints

- 参数值前端做范围校验，后端做兜底校验
- 不破坏现有 composerState 结构（新增字段，参考迁移幂等约定）
- 模型切换时若新模型 maxTokens 上限低于当前设置，需 clamp 或提示

## Notes

- 参考 DEEIX-Chat `sections/chat-model-config.tsx`、`hooks/use-chat-model-options.ts`
- 参考 kivio `ThinkingLevelSelector.tsx`（思考等级选择，参数 picker 同构）
- 架构级任务，须补 `design.md`（composerState 字段、后端契约、模型上限来源）+ `implement.md`
