# Chat 消息分支操作增强

## Goal

扩展 `branch.ts` 现有分支能力，补齐两个改同一文件的功能：单条消息删除、继续生成。属架构级任务。

## Requirements

### 1. 单条消息删除（#1）
- 用户消息与 assistant 消息均支持删除（hover 出删除按钮）
- 软删除：保留版本树结构，被删消息从默认视图隐藏但可恢复（design 阶段确认软删标记字段）
- 删除中间消息时，其后续消息保留（不级联删）
- 删除带分支的消息时，仅删当前选中版本，兄弟版本保留
- 删除操作需二次确认（防误触，可用现有 ConfirmDialog）
- 删除后版本切换器计数同步更新

### 2. 继续生成 Continue Generation（#11）
- assistant 消息底部增加「继续生成」按钮（与「重新生成」并列）
- 行为：在当前 assistant 消息内容末尾续接生成 token（非重新生成整条）
- 需后端 chat 接口新增 continue 能力：传入被续接消息 id，后端以其已有内容作为前缀继续补全
- 生成过程复用现有 SSE 流式通道与停止能力
- 续接产生的新内容追加到原消息，不产生新分支版本（除非用户随后编辑/重生成）

## Acceptance Criteria

- [ ] 任意消息可删除；删除后从视图消失，版本计数正确
- [ ] 软删的消息在 design 确定的入口可恢复
- [ ] 删除中间消息不影响其后续消息
- [ ] 删除带兄弟版本的消息只删当前版本
- [ ] assistant 消息「继续生成」能在末尾续接出新内容
- [ ] 续接过程可中途停止
- [ ] 删除与续接均不破坏现有版本切换、编辑、重新生成

## Constraints

- 改 `branch.ts` 与 `actions/conversations.ts`，优先新增方法不改旧逻辑
- 后端 continue 能力不能影响现有 chat / regenerate / edit 路径
- 续接生成要正确传递被续接消息的 toolCalls/artifact 上下文（design 阶段确认边界）
- 删除字段加到 Drizzle schema，需迁移（参考最近 commit `e839492` 的迁移幂等化约定）

## Notes

- 架构级任务，须补 `design.md`（软删字段、continue 后端契约、版本树一致性）+ `implement.md`
- 依赖关系：`chat-regenerate-switch-model` 依赖本任务的分支基础
