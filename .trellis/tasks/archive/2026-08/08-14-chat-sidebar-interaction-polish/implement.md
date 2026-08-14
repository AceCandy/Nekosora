# Chat 侧栏交互与研究状态修复实施计划

1. [x] 为浏览器本地分组边界、服务端 ISO/严格递减边界校验、分组 predicate、计数、每组 20 条键集分页和属主隔离补定向测试；先证明跨日、夏令时、跨年、末页、非法/乱序边界、重复 cursor 和当前会话补入场景失败。
2. [x] 在会话导航 model/Server Actions 中实现分组 DTO、摘要和页面查询，保留现有首屏全局 30 条及完整排序键；运行 conversations/navigation 定向测试。
3. [x] 为 Sidebar 每组状态、generation 竞争、离线/10 秒超时、重试和去重补纯逻辑或组件测试；再接入分组标题、真实总数、历史/归档懒加载和组内加载更多。
4. [x] 接入既有重命名 Action，并补标题校验、失败反馈和 i18n；实现置顶/取消置顶、归档/恢复、重命名后的当前会话 `scrollIntoView({ block: "nearest" })` 定位，补操作与重排回归测试。
5. [x] 使用共享 Popover 替换滚动容器内菜单；仅在需要时为共享原语补自动上下翻转。补底部空间、scrollHeight 不变、菜单焦点返回、Tab 可见及 Escape/外部关闭测试，并回归现有 Popover 显式 `side` 调用方。
6. [x] 强化生成中标识的静态与动画状态；移除移动端独立 Logo 行，把菜单 trigger 接入 ChatHeader 首行，保持桌面布局不变并清理本次变更产生的 orphan props/import/i18n。
7. [x] 先在 `researchProcess.test.ts` 增加“phase 已 answering 但 search 仍 calling/running”的失败用例，再按“活动步骤优先，answering 为首个正文前 canonical 边界”修正 `buildResearchStatus`；覆盖流式、历史、无搜索和异常终态。
8. [x] 运行受影响的 Vitest 定向测试、`pnpm check`、`pnpm test`、Web 生产构建、`git diff --check` 和 `task.py validate`。
9. [x] 复用本项目既有 3500 开发实例完成登录态桌面/390px 浏览器回归：验证分组总数、组内分页、历史/归档折叠、离线重试、底部菜单、重命名入口、Tab 可见、移动首行和关闭抽屉 inert；关闭浏览器会话且未停止既有服务。
10. [x] 独立复核需求到测试的映射、Server/Client 边界、属主隔离、迟到响应、共享 Popover 回归和敏感/临时产物；发现失败时按模块回滚，不执行数据迁移或扩大范围。

## Review Gate

- `prd.md`、`design.md`、本实施计划与两个 context manifest 通过 `task.py validate`。
- 用户审阅本轮最终规划摘要并在后续消息明确批准后，才执行 `task.py start` 和产品代码修改。

## Rollback Points

- 分组查询与 Sidebar 接线分开提交/复核，可独立退回现有全局窗口。
- 共享 Popover 只接受有测试约束的最小改动；若影响现有调用方，保留原语并仅回退自动翻转部分。
- 研究状态为独立纯函数变更，可单独回退，不影响搜索编排和持久化数据。
