# MAGI 项目进化第 5 轮

## Goal

让新创建的分享真正冻结创建时可见的消息正文，同时保留通过软删除撤回公开内容的能力，并确保历史分享无损兼容。

## Background

- `conversation_shares` 当前只保存标题、模型和消息 publicId 数组，不保存正文（`src/db/schema/pg.ts:488`）。
- `getShare` 每次从 `messages` 实时读取正文（`src/features/chat/actions/share.ts:60`）。
- `editMessage` 会保留 user `publicId` 并原地更新正文；续写也会保留 assistant `publicId` 并原地追加正文，因此旧分享目前会随实时正文变化（`src/features/chat/actions/branch.ts:332`）。
- 软删除会使消息从已有分享链接隐藏；这是现有隐私契约。
- 分享页使用“对话分享快照”“静态只读归档”等文案，当前数据行为与该语义不一致。

## Requirements

- 新分享必须按创建时客户端提交并经服务端验证的消息顺序，保存 `{ publicId, role, content }` 正文快照。
- 新分享创建后，编辑 user 消息或续写 assistant 消息不得改变已分享正文。
- `getShare` 必须继续依据当前未软删除消息集合过滤快照；软删除部分或全部消息后，对应公开内容必须隐藏。
- 历史分享的正文快照字段保持 `null`，继续按现有消息 ID 动态读取，不得用升级时的当前正文伪造创建时快照。
- 撤销分享后必须继续不可访问，且仅会话属主可撤销。
- 新增 nullable JSONB 字段时，必须提供 PostgreSQL 迁移并同步 Drizzle journal 和 snapshot。

## Acceptance Criteria

- [x] 新分享写入有序的消息正文快照，公开页返回创建时的 `role` 和 `content`。
- [x] 创建分享后编辑 user 消息，公开链接仍显示创建时正文，并有回归测试。
- [x] 创建分享后续写 assistant 消息，公开链接仍显示创建时正文，并有回归测试。
- [x] 创建分享后软删除部分消息，仅隐藏被删除项且保留其余快照顺序；全部删除时保留现有元数据契约并返回空消息列表。
- [x] `message_snapshots_json IS NULL` 的历史分享仍按消息 ID 动态读取并保持可访问。
- [x] 撤销分享、属主校验和消息全集校验不回归。
- [x] PostgreSQL schema、迁移、Drizzle journal/snapshot 一致。
- [x] lint、typecheck、全量测试和生产构建通过。

## Out Of Scope

- 回填历史分享正文。
- 改造消息编辑、续写、重生成或软删除机制。
- 改变分享 URL、撤销入口或公开页面布局。
- 将分享改为软删除也无法撤回的完全不可变归档。
