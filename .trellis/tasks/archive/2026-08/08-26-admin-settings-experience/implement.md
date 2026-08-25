# 实施计划

1. 账号删除闭环
   - 在现有 admin actions 中接入 Better Auth `removeUser`，保留 `requireAdmin` 与本人保护。
   - 用户列表标记当前账号，页面增加操作列和小型确认按钮组件。
   - 验证：单测覆盖本人拒绝、他人删除调用与 revalidate；手动确认取消/失败反馈。

2. 健康维度与名称
   - 聚合键扩为 `providerRef + providerName + upstreamModel/model`，显示服务商与模型两列。
   - 更新中英文标题、表头、旧数据占位和现有窗口测试。
   - 验证：测试保留 90 天窗口，断言不再渲染 `providerRef` 作为可见值。

3. 长期记忆性能根因修复
   - 把 Mem0 读取、过期过滤与尽力清理收进缓存未命中回调，移除命中前的清理查询。
   - 验证：单测断言连续两次读取只调用一次 `getAll`，并覆盖过期过滤、删除失败降级。

4. 设置中心界面修整
   - 移除个人配置分组标题，补角色导航测试。
   - 新增 Next 原生 dash template，使用 200ms 状态反馈型过渡和减弱动效兜底。
   - 返回聊天两个入口增加箭头位移反馈，不改变焦点或导航语义。

5. 指令卡展示
   - 用现有 `Markdown` 替换截断的原文 `<pre>`，用有界滚动保持卡片尺寸。
   - 保留标题、触发词、描述、编辑、删除和使用次数原行为。

6. 质量与浏览器验收
   - 运行针对性 Vitest：admin actions、operations、memory service、nav config。
   - 运行 `pnpm --filter @nekusora/web lint`、`pnpm --filter @nekusora/web typecheck`。
   - 独立复核权限、SQL 分组/null 回退、缓存失败路径、Server/Client 边界、i18n 与 reduced-motion。
   - 用浏览器检查账号、运维、记忆、指令卡和侧栏切换；覆盖桌面、390px 移动端、键盘焦点与减弱动效。若启动本地服务，验收后关闭。

## Rollback Points

- 账号删除 action 与按钮可整体回滚，不影响其他六项。
- 健康 SQL 若出现兼容问题，可回滚页面查询，无 schema 迁移。
- 记忆读取若 Mem0 `showExpired` 行为异常，可回滚到原双查询路径。
- template、Markdown 预览与按钮动效均为展示层独立回滚点。
