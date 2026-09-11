# 验证与复核

- 回归先红：Core 18 项、Web 7 项暴露旧入口缺少校验；修复后针对性 61 项通过。
- pnpm check 通过；初版 pnpm test 1889 passed / 42 skipped。后补合法多模态/工具消息契约已在 Web 路由 29 项及最终全仓测试中通过。
- 独立只读审查未发现核心回归；提示核对消息额外字段与可选 null。
- 主线程核对 chatStreamStore.ts:738、854、971、1037 四请求：消息均显式投影 role/content，parentPublicId 缺省为 undefined；其余分支标识是服务校验后的字符串。outputModeId 的显式 null 仍由原 Composer schema 保留，不改变合法客户端行为。
- MCP 缺 query/未知工具保留原工具级错误，非法 query 类型改 -32602；Rate 仍在 JSON 解析前。
- 未调用真实上游或运行浏览器；本批 PG 查询不变，第一批隔离 PG 结果不冒充 HTTP 端到端验收。

## 根因与预防
请求 JSON 的 TypeScript 断言不是运行时校验。改为入口 schema + 既有消息 parser，新增无数据库/上游副作用断言。新增错误不返回输入内容或原始异常。契约同步 error-handling.md。
