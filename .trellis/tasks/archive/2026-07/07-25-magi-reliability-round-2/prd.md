# MAGI 第二轮可靠性审视

## Goal

修复公开分享在消息软删除后仍返回已删除正文的数据泄露，使分享读取始终遵守聊天消息的可见性边界，并通过回归测试和独立复核证明修复有效。

## Background

- 第一轮已修复 Agent 多工具消息序列与网关流取消，工作提交为 `397c11e`、`a852f17`。
- 历史与当前代码证明 `wasNewConversation` 持续为 true 是避免跨 segment 重挂的刻意设计，新会话侧栏由 store 乐观状态同步。
- `ChatMessageList` 的 index key 适用于当前只追加、原位替换、末尾截断语义；直接改为延迟回填的 `publicId` 会使流式消息中途重挂。
- WebChat 持久化消息内容当前均为字符串，多模态 part 只在当次请求组装，不写回消息表；因此不以不可达的 `[object Object]` 压缩场景作为本轮目标。
- 第二轮审视已覆盖四个独立区域：聊天 API 生命周期、权限边界、模型目录/路由和前端核心交互。
- 权限边界候选优先级最高：`createShare` 会记录当前可见消息 ID（`src/features/chat/actions/share.ts:18`），但公开 `getShare` 按会话加载全部消息且未过滤 `deletedAt`（`src/features/chat/actions/share.ts:53`）。属主在创建分享后调用 `softDeleteMessage`（`src/features/chat/actions/branch.ts:477`），原分享链接仍能返回被隐藏的正文。
- 现有 `share.test.ts` 只覆盖创建分享时排除已删除消息和撤销鉴权，没有覆盖公开读取（`src/features/chat/actions/share.test.ts:35`）。
- 历史提交 `30d701e` 与 `.trellis/spec/backend/chat-message-references.md` 已确立“软删除内容不得重新进入公开分享”的契约；当前读取行为不是刻意设计。

## Requirements

- R1. `getShare` 加载分享快照消息时，查询必须同时约束快照所属会话与 `messages.deletedAt IS NULL`。
- R2. 分享快照的消息顺序、标题、模型、撤销状态和最后访问时间更新行为保持不变。
- R3. 分享中的部分消息被软删除时，仅排除已删除消息；全部快照消息均被删除时，保留有效分享元数据并返回空消息列表。
- R4. 修复必须有先失败后通过的回归测试，并完成独立复核与项目质量门。
- R5. 只修改分享读取、对应测试与相关规范，不顺手修复其他候选或增加产品功能。

## Acceptance Criteria

- [x] AC1. 审视覆盖聊天 API 生命周期、权限边界、模型目录/路由与前端核心交互四个独立区域。
- [x] AC2. 最终候选证据证明输入真实可达、行为违背现有契约、当前测试未覆盖。
- [x] AC3. 实施前形成明确的范围、兼容性、回滚点与验证命令。
- [x] AC4. 回归测试在旧实现上失败、修复后通过。
- [x] AC5. lint、类型检查、全量测试和生产构建通过，独立复核无未处理阻断问题。
- [x] AC6. 记录改了什么、验证了什么、未验证什么、剩余风险与下一轮方向。

## Out of Scope

- 已否决的三个候选：修改 `wasNewConversation`、直接将列表 key 改为 `publicId`、为当前不可达的持久化多模态压缩路径增加逻辑。
- 第一轮已经处理的 Agent 多工具序列与网关取消。
- 本轮审视发现但未选中的候选：压缩快照与记忆抽取并发竞态、`softDeleteMessage` 的跨用户消息存在性枚举、附件上传失败污染用户消息、无有效模型时输入丢失、`fixed` 推理格式缺少档位映射。
- 新功能、数据库迁移、依赖升级、视觉改版、远端推送。
