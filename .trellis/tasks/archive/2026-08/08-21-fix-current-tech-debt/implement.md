# 技术债修复总体实施计划

1. 完成并启动 `08-21-fix-model-catalog-reasoning`。
   - 验证：目录 invariant、同步 planner、请求体翻译测试；迁移/journal/snapshot 一致。
2. 完成并启动 `08-21-enable-ci-postgres-tests`。
   - 验证：本机 pgvector 服务下所有目标 PG 套件真实执行；workflow lint 通过。
3. 完成并启动 `08-21-harden-storage-readiness`。
   - 验证：环境变量、存储工厂和重复 readiness 探针测试。
4. 完成并启动 `08-21-fix-frontend-tech-debt`。
   - 验证：相关 Web 单测、lint、typecheck。
5. 完成并启动 `08-21-cleanup-tooling-dependencies`。
   - 验证：actionlint 脚本测试、依赖检查、Core/Web lint 与 typecheck。
6. 父任务做最终集成复核。
   - 运行 `pnpm quality:workspace`、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
   - 运行 `pnpm build`、`pnpm build:gateway`、`pnpm build:worker`。
   - 检查 `git diff --check`、迁移文件、journal/snapshot 和无关改动。

## Rollback Points

- 每个子任务验证通过后形成一个独立提交，再进入下一项。
- 任一子任务失败时停在该子任务内修复或回滚，不继续叠加后续改动。
