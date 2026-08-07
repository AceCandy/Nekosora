# 修复搜索超时回退与模型展示 - Design

## Boundaries

- `searchWeb` 负责两级超时、后端跳过和尝试结果。
- `createWebSearchTool` 的闭包持有本次回答内的超时后端集合，并在每次逻辑搜索之间复用。
- `executeHostedModelSearch` 在选中实际路由时回传显示身份，不持有跨调用状态。

## Data Flow

1. `createWebSearchTool` 将 `timedOutBackendKeys` 传给 `searchWeb`。
2. `searchWeb` 为每个后端组合外层信号、30 秒总信号和 10 秒后端信号。
3. 后端信号超时：记录 `timeout`，继续下一后端。
4. 总信号超时：记录 `timeout`，结束本次搜索。
5. `searchWeb` 返回 attempts 后，工具闭包把 timeout 后端键加入集合，供后续搜索跳过。
6. Hosted adapter 选中路由时回调 `{ id, name }`，`searchWeb` 在成功前即可更新 attempt identity。

## Compatibility

- `SearchWebExecutionOptions` 新增可选只读集合，不影响现有调用方。
- Hosted 路由身份回调为可选内部参数。
- 不新增持久化字段；历史记录格式不变。

## Rollback

- 回滚 `searchWeb` 的后端信号和跳过集合即可恢复原超时行为。
- 身份回调独立，可单独回滚且不影响搜索结果。
