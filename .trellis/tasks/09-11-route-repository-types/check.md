# 验证与复核

- 从真实 schema 的 $inferSelect 推导仓储返回值，查询与授权、路由排序、熔断逻辑保持不变。
- 类型检查发现并补齐四处测试夹具的可空/必需字段；新增 expectTypeOf 回归，防止公开字段退化为 any。
- 针对性四文件 79 项通过；随后全仓 pnpm check、pnpm test 通过，pnpm build:gateway 成功。
- 独立只读审查及主线程 diff 复核未发现明确回归；没有新增 schema any 或整体结果强转。
- 未调用真实上游；底部 listModelsByCapability 的历史类型债不在本批范围，未顺带改造。
