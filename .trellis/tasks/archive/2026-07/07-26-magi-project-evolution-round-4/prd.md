# MAGI 项目进化第 4 轮

## Goal

分享点击瞬间屏幕上可见的消息版本，确保公开链接与用户确认的内容及顺序一致，避免无意公开重生成产生的隐藏版本。

## Background

- `createShare(conversationId)` 当前把会话全部未软删除消息写入快照（`src/features/chat/actions/share.ts:7`）。
- `getVisibleBranch` 默认只展示最新叶子主线（`src/features/chat/actions/branch.ts:371`），版本切换还会在客户端 runtime 中替换当前 assistant 的 `publicId`（`src/features/chat/store/chatStreamStore.ts:615`）。
- 分享入口只传 `conversationId`，服务端不知道点击瞬间的可见版本（`src/features/chat/components/ChatHeader.tsx:21`）。
- 用户已选择“分享点击瞬间屏幕上可见的分支”，不分享服务端默认主线或全部历史版本。

## Requirements

- `ChatComposer` 必须按 `runtime.messages` 当前顺序把全部可见消息 `publicId` 交给分享入口；版本切换后的目标 ID 必须随之进入快照。
- 流式生成中、空会话或任一可见消息尚无 `publicId` 时必须禁用分享，不能创建部分快照。
- `createShare` 必须接收有序消息 ID 列表，并在服务端校验：列表非空、无重复，且每个 ID 都对应当前用户会话内一条未软删除消息。
- 任一 ID 无效、已删除、跨会话或跨用户时必须整体拒绝，且不能写入分享记录。
- `messageIdsJson` 与 `defaultMessageIdsJson` 必须保留客户端提交顺序，不能依赖 PostgreSQL 返回顺序。
- 现有会话属主校验、公开读取时软删除过滤、撤销分享和公开页面行为保持不变。

## Acceptance Criteria

- [x] 同父 assistant 存在旧、新两个版本且屏幕显示新版时，分享快照只含新版；切换到旧版后新快照只含旧版。
- [x] 快照 ID 顺序与点击时 `runtime.messages` 顺序完全一致，即使数据库验证查询返回逆序。
- [x] 空列表、重复 ID、跨会话 ID、其他用户会话 ID或已软删除 ID 均拒绝，且不执行 insert。
- [x] 流式中、空会话或可见消息缺少 `publicId` 时分享按钮禁用。
- [x] 已软删除消息不会从已有公开链接读取；属主撤销分享行为不回归。
- [x] 定向测试、lint、typecheck、全量测试和生产构建通过。

## Out Of Scope

- 持久化用户当前版本选择或改变刷新后的默认分支。
- 强制客户端提交的消息 ID 构成数据库中的连续 `parentId` 链；现有 UI 可只替换中间 assistant 版本并保留后续消息。
- 改造消息树、重生成、编辑、公开分享页面布局或历史分享记录。
- 把正文复制进分享表；现有分享继续保存消息 ID 快照，并在读取时应用软删除过滤。

## Risks And Deferred Items

- Server Action 参数来自客户端，TypeScript 类型不能替代运行时全集校验。
- 当前分享是消息 ID 快照而非正文快照；消息内容后续若被原地编辑，公开链接仍可能变化。本轮不改变该既有模型，列为后续审视候选。
