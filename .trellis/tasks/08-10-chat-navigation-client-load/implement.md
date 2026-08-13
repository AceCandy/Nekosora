# 实施计划

1. 固化分页查询与索引
   - 为会话导航定义 30 条固定窗口、服务端游标校验、完整排序和 keyset 谓词。
   - 新增匹配查询的 PostgreSQL 索引，生成并核对 SQL、journal、snapshot。
   - 补 action/schema/migration 测试，覆盖属主隔离、相同时间戳、跨分组、删除、重复游标、并发新增和末页。

2. 接入有界 RSC 与 Sidebar 增量加载
   - Chat layout 只序列化首屏 page；Sidebar 本地合并后续 page。
   - 增加加载更多的 pending、失败重试和末尾状态，不改变现有分组及移动抽屉结构。
   - 当前 pathname 项缺失时通过属主隔离 action 按完整排序键补入，保留乐观新会话逻辑。
   - 补组件测试，验证合并、末页、当前项、mutation 刷新和搜索独立性。

3. 收敛生成状态轮询
   - 只查询当前用户有效活动 run 并按 conversation 去重，首屏单独传递活动 ID 以驱动轮询。
   - 保持“从活动变为缺失即完成”的蓝点与刷新语义，覆盖活动会话不在首屏窗口的测试。

4. 记录并守住客户端加载边界
   - 将当前 Artifact、Mermaid、Recharts 动态加载和生产 chunk 基线写入研究结论。
   - 不修改 Markdown/Streamdown 加载边界；若实施时没有新的可归因数据，明确以“无证据不拆分”完成该项。

5. 验证与独立复核
   - 定向运行会话 action、Sidebar、schema/migration 测试。
   - 运行 `pnpm check` 与 `pnpm test`。
   - 使用生产构建确认迁移后的客户端编译和产物，不以开发 chunk 代替生产结论。
   - 启动 Web 后用浏览器验证桌面与 390px：首屏/加载更多、慢网络、键盘焦点、当前深链项、创建、删除、重命名、置顶、归档和移动抽屉；结束前关闭服务。
   - 使用独立检查流程复核 spec、数据流、测试与 diff。

## 回滚点

- 查询契约与 Sidebar 接入作为同一提交边界，任一失败时整体回退，不能留下有限首屏但无继续加载的状态。
- 索引回滚通过后续迁移删除，不改写已执行的新增迁移。
- Markdown 维持现状，不产生该部分回滚负担。

## 计划验证命令

```bash
pnpm --filter @nekusora/web test -- src/features/chat/actions/conversations.test.ts
pnpm --filter @nekusora/web test -- src/features/chat/components/Sidebar.test.tsx
pnpm --filter @nekusora/web test -- src/db/schema/pg.test.ts
pnpm check
pnpm test
pnpm build
```
