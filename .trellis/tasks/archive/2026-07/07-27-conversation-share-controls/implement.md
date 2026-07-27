# 网盘式对话分享实施计划

## 成功标准

- PRD 中所有验收项都有实现和自动化测试映射。
- 新快照不再依赖实时消息状态；实时分享读取与 Chat 相同的持久化版本选择和样式状态。
- 密码明文不会落库、进 URL/日志/客户端持久化；解锁限流在多实例下由 PostgreSQL 原子保证。
- 旧分享继续按兼容分支访问；迁移/journal/snapshot 连续且可回滚。

## 实施步骤

1. **先补数据与安全层测试**
   - 为 schema/migration 添加失败测试：分享模式、到期、password verifier、样式快照、会话版本选择、解锁尝试表与索引。
   - 为 scrypt verifier、HMAC Cookie、到期裁剪、常量时间校验和限流状态机添加单测。
   - 验证：目标 Vitest 用例先按预期失败。

2. **扩展 PostgreSQL schema 与类型**
   - 修改 `src/db/schema/pg.ts`、`src/db/types.ts`。
   - 运行 `pnpm db:generate:pg` 生成下一条迁移；检查 SQL、journal 和 snapshot，只保留本任务相关变化。
   - 增加 migration 元数据测试。
   - 验证：schema/migration 测试通过，历史 journal 未改写。

3. **实现分享安全基础设施**
   - 新增异步 scrypt verifier helper、域分离 HMAC Cookie helper 和分享解锁限流 repository/service。
   - 所有错误文案使用稳定错误码/DTO，不记录密码、Cookie、原始 IP 或 verifier。
   - 验证：正确/错误/畸形 verifier、过期/串用 Cookie、并发失败计数、窗口重置和 Retry-After 测试通过。

4. **持久化 Chat 消息版本选择**
   - 提取共享可见分支解析器；`getVisibleBranch` 保留属主鉴权 wrapper。
   - 新增版本选择 action，校验目标消息、兄弟组和会话属主后原子更新 JSON。
   - 更新 store 切换流程和 Chat SSR，保证切换后刷新仍显示相同版本。
   - 验证：版本选择、陈旧选择回退、跨会话拒绝、刷新恢复和新增消息分支测试通过。

5. **重构分享 actions/service**
   - 用判别联合输入替换裸 `conversationId + messageIds` 创建契约，服务端派生当前可见消息。
   - 实现 snapshot/live/legacy 三条读取路径、有效期、统一不可用状态、当前会话分享列表和幂等撤销。
   - 实现解锁 action：限流 -> scrypt 校验 -> Set-Cookie；锁定响应不得携带私密元数据。
   - 验证：严格快照、实时变化、旧记录、到期/撤销/密码、属主隔离和列表脱敏测试通过。

6. **抽取 Chat 只读消息展示原语**
   - 从 `ChatMessageItem` 抽取用户/助手正文渲染，复用现有 `Markdown`、renderer、错误边界和样式类。
   - Chat 原交互行为保持不变；公开页不传交互能力。
   - 验证：Chat 快照/组件测试无回归，Markdown 代码块、表格、链接和 custom renderer 测试通过。

7. **实现分享配置与管理界面**
   - Chat Header 分享按钮改为打开配置对话框。
   - 实现模式分段控件、有效期、自定义日期时间、快照样式、可选密码、实时风险提示和创建结果复制。
   - 加入当前会话分享列表、状态、复制和撤销确认；配置不可编辑。
   - 所有文案同步现有国际化资源；复用 `copyToClipboard`，不直接调用 `navigator.clipboard`。
   - 验证：表单联动、校验、取消、创建、复制 fallback、列表刷新和撤销组件测试通过。

8. **实现公开分享页**
   - 按 `unavailable/locked/ready` 渲染统一不可用、密码解锁和只读对话。
   - ready 状态按模式获取样式并注入受作用域约束的 CSS；设置 `noindex, nofollow`。
   - 验证：响应不泄露、Cookie 解锁、到期/撤销、默认/冻结/实时样式及移动端布局测试通过。

9. **全量复核与浏览器验证**
   - 运行目标测试后执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
   - 使用浏览器验证桌面与移动端：创建两种模式、密码错误/正确、复制、撤销、过期状态、Markdown、样式、版本切换和新增消息。
   - 检查控制台无 hydration、Server Action 或 Clipboard 异常；检查锁定/不可用响应不含私密字段。
   - 若代理自行启动调试服务，验证结束前关闭；用户已有服务不擅自关闭。

## 高风险文件与回滚点

- `src/features/chat/actions/branch.ts` / `chatStreamStore.ts`：版本选择持久化可能影响正常 Chat；先用独立解析器测试锁定现有默认行为。
- `src/features/chat/actions/share.ts`：公开数据边界；所有返回类型使用判别联合并测试“不含字段”，避免先取全量再在客户端隐藏。
- `src/features/chat/components/ChatMessageItem.tsx`：只做展示原语抽取，不重排无关交互逻辑。
- `src/db/schema/pg.ts` 与 `drizzle/pg/**`：只追加迁移，不改历史；旧应用忽略新列即可回滚。
- 密码/限流 helper：不得降级为裸 SHA-256 或进程内计数；数据库限流不可用时解锁应失败关闭，公开无密码读取不受影响。

## 验证命令

```bash
pnpm test -- src/features/chat/actions/share.test.ts
pnpm test -- src/features/chat/actions/branch.test.ts
pnpm test -- src/lib/chat/share-security.test.ts
pnpm test -- src/lib/chat/conversation-share-migration.test.ts
pnpm lint
pnpm typecheck
pnpm test
```

实际文件名可在实现时按现有目录职责调整，但验证范围不得缩小。
