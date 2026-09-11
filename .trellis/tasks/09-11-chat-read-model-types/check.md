# 验证与复核

- 恢复 output modes/render styles 的查询推断；分享路径使用 Database/Schema/表推导，不改变查询、鉴权、事务或公开字段。
- visible-branch 仅增加泛型以保留输入行类型，算法未变。
- 两聊天页复用纯选项投影；新增顺序、来源、空展示名、空列表和私密字段排除测试。
- 新测试夹具曾因 visibility 扩宽、capabilities 错用 null 被类型检查拦截，已改为真实 schema 支持的数据。
- 最终 pnpm check 通过；全仓测试 1893 passed / 42 skipped，包含既有 share/branch/服务测试；Web 和 Worker 构建成功。
- 独立只读审查与主线程 diff 复核未发现明确回归；最后仅调整测试夹具，已重新执行全仓测试。
- 保留 renderer 的字段级枚举断言：数据库是 text，本批不扩展为历史数据清理或 schema 迁移。其他返回字段仍接受静态检查。
- 未做浏览器、线上数据或真实上游验收；未改 UI、缓存和页面降级策略。
