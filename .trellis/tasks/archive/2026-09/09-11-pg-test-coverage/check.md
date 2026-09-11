# 验证与复核

- 先补入口回归，修复前 3 项失败；修复后 postgres-tests 4 项通过。
- pnpm check 通过；pnpm test：1855 passed / 42 skipped（含根脚本 25 项）。
- 在仅绑定本机的临时 pgvector:pg17 容器运行 pnpm test:pg，退出 0：Core 6 文件 39 项、API key 3 项、队列 clean/timeout drain 均通过。
- 查询确认随机测试库残留 0，已停止并自动删除临时容器。未访问远程配置数据库。
- 主线程在实现后独立阅读完整 diff：命令仍按 && 顺序失败即停；不改 schema、业务查询或队列实现；新增本机保护在连接前运行。
- 未验证 GitHub 托管执行、生产容器构建、浏览器和真实上游；本批不改应用运行时。

## Bug Analysis: PG 测试入口遗漏
### 1. Root Cause Category
C（变更传播失败）/ D（覆盖缺口）：新增 PG 文件与手写 runner、根命令未同步。
### 2. Why Fixes Failed
非反复修复问题；旧断言重复固定清单，无法发现新文件遗漏。
### 3. Prevention Mechanisms
新增文件发现断言，覆盖全部 Core PG 文件；补 Worker 命令与本机保护检查，均通过。
### 4. Systematic Expansion
检查根入口、Core runner、Worker runner 与两个 CI 工作流：均由根 test:pg 驱动，无需复制 workflow 步骤。
### 5. Knowledge Capture
已更新 ci-container-publishing.md；本项目没有对应 src/templates 目录，不创建无用模板。
