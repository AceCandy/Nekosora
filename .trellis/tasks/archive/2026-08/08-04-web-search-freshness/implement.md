# 联网搜索结构化时效控制实施计划

1. 扩展共享搜索与 trace 契约
   - 为工具输入增加 freshness / 日期范围校验和 JSON schema 描述。
   - 为搜索 options、bundle、attempt、citation 和 trace 增加可选范围、回退及 `publishedAt` 字段。
   - 验证：工具无时间参数兼容；冲突/非法日期在网络前失败。

2. 实现 provider 和 Hosted Search 能力映射
   - Tavily 发送 `time_range` 或 `start_date/end_date`，读取 `published_date`。
   - SearXNG 仅为 month 发送 `time_range=month`。
   - Google Hosted Search 将规范化范围转换为 `timeRangeFilter`。
   - 其余后端对硬时间范围返回 unsupported，不发送无限制请求。
   - 验证：逐 adapter 断言请求体/查询参数，unsupported 路径断言零网络调用。

3. 重构有序执行为有界范围轮次
   - 普通查询保持单轮。
   - week 失败后仅增加一轮 month；month/明确日期不放宽。
   - 缓存键加入范围；成功 bundle 记录实际范围与 fallback。
   - 验证：后端顺序、首个成功、两轮上限、缓存隔离和取消/超时保持正确。

4. 保留日期和可观测元数据
   - 统一规范化合法日期并写入搜索上下文、工具结果、SSE/trace 和历史投影。
   - 旧 trace 缺字段时继续恢复；续写合并不丢新增字段。
   - 验证：live、refresh、continue 三条链路字段一致。

5. 独立复核与质量门槛
   - 先运行 web-search、completion coordinator、SSE/store/history 的目标测试。
   - 再运行 `pnpm check`、`pnpm test`、`git diff --check`。
   - 复核没有修改配置版本、数据库迁移、Drizzle journal/snapshot 或用户无关文件。

## Risky Files

- `src/db/types.ts` 与部分聊天展示文件已有用户未提交修改；实施时必须基于当前工作树增量编辑，不覆盖现有内容。
- Hosted Search 的 provider 支持判断必须基于 route 的 `webSearchFormat`，不能按模型名称或 URL 猜测。

## Rollback Point

本任务无数据库迁移。任何阶段失败都可仅回滚本任务新增的可选类型、provider 参数和服务编排，不影响现有配置及历史 JSONB。
