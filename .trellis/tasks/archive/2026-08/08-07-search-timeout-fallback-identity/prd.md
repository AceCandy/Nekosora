# 修复搜索超时回退与模型展示

## Goal

为单个搜索后端设置独立超时并在同次回答中跳过已超时后端，同时在 Hosted 路由选中时记录可读模型名称。

## Background

- 当前 30 秒超时同时作为单个后端和整条搜索链的截止时间；优先级第一的 Hosted 模型耗尽预算后，后续 Tavily 等后端没有执行机会。
- 每次逻辑 `web_search` 都重新从第一后端开始，同一次回答可能连续三次等待同一模型超时。
- 指定模型尝试在成功前使用数据库 UUID 作为 `name`，导致超时和无结果状态无法展示可读模型名。

## Requirements

- 每个搜索后端有独立的 10 秒执行预算，整条逻辑搜索保留 30 秒总预算。
- 单个后端超时只记录该次尝试并继续后端链；只有总预算耗尽或外层取消才停止整条链。
- 同一次回答内，后续逻辑搜索跳过已经超时的后端；失败状态不得跨回答共享。
- 跳过的后端保留安全、可理解的尝试记录，且不发起网络请求。
- Hosted 模型路由一旦被实际选中，就用路由的 `modelName` 更新尝试身份；超时、无结果和成功均显示可读名称。
- 不改变后端配置顺序、周到月回退、外层取消传播或并行搜索行为。

## Acceptance Criteria

- [x] 第一后端在 10 秒后超时时，同一逻辑搜索继续调用下一后端。
- [x] 整条搜索达到 30 秒总预算时停止继续回退。
- [x] 同一次回答的后续搜索不再调用已经超时的后端。
- [x] 一个并行搜索调用超时不会污染其他调用的尝试数据，但共享本次回答的超时后端集合。
- [x] Hosted 模型超时或无结果时，尝试记录显示路由模型名而非 UUID。
- [x] 外层取消仍立即终止搜索。
- [x] 相关定向测试、Core 类型检查和完整 Core 测试通过。

## Out of Scope

- 不跨回答或跨进程维护后端健康状态。
- 不修改用户配置、数据库结构或前端组件。
- 不保证第三方上游在收到取消信号后立即释放其服务端计算资源。

## Risks

- 10 秒可能不足以完成高延迟 Hosted 搜索，但后续 Provider 将获得实际回退机会；整条链仍受 30 秒总预算保护。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
