# 实施与验证

1. 增加五项缺陷的回归测试，确认修复前失败。
2. 修复 Chat 版本投影和续写持久化，运行相关测试。
3. 修复提示词、strict 和安全下载边界，运行 parser/stream/下载及真实 SDK 协议测试。
4. 独立复核 diff，更新必要的边界规范。
5. 执行 pnpm check 和 pnpm test，清理临时产物并报告未运行的外部验证。不提交代码或部署。

## 完成记录

- 五项修复及回归测试已完成；安全下载复用共享公网请求，并修正公网 IPv6 字面量的校验/连接兼容性。
- 修复前回归确认了提示词、strict、版本状态、续写 SQL 和公网 IPv6 的失败；修复后相关测试通过。
- 最终 `pnpm check`（工作区门禁、lint、含测试的 typecheck）与 `pnpm test` 全部通过；普通测试中显式隔离的 PG 项仍按配置跳过。
- 独立本地 PostgreSQL 的 `pnpm --filter @nekusora/web test:core-pg` 通过：6 个套件、42 项测试，包含续写 reasoning 追加/保留/中断与事务回滚。
- 原 DATABASE_URL 被本机安全检查拒绝，未连接或修改对应数据库。验证改用临时容器，测试数据库与容器均已清理。
- 下载器、公网请求与真实 SDK 协议矩阵的定向测试通过：4 个文件、65 项；真实 SDK 使用 mock 上游响应，不是外部供应商联调。
- Chat、下载安全、system/strict 三部分独立只读复核无确认缺陷；主线程最终 `git diff --check` 通过。
- 已更新 `model-message-boundary` 和 `chat-run-metadata` 的边界契约。
- 未执行生产构建、浏览器交互、外部供应商或生产环境验证；未提交、部署。历史已丢失 reasoning 无法恢复；strict 最终执行仍受安装 SDK 与上游模型支持范围约束。
