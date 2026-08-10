# CI 与制品质量门禁

## Goal

让每个 PR 在合并前自动验证代码质量，并让发布流程覆盖 Web、Gateway、Worker 三类生产制品。

## Background

- `.github/workflows/docker-publish.yml:12-17` 仅由定时、Tag 和手动触发，仓库内未见 PR 质量 workflow。
- `.github/workflows/docker-publish.yml:102-113` 只使用默认 Dockerfile；`Dockerfile.gateway` 与 `Dockerfile.worker` 未进入可见发布流程。

## Requirements

- R1. PR 与 main push 至少运行冻结依赖安装、`pnpm check` 和 `pnpm test`，失败时阻止后续制品发布。
- R2. CI 显式验证根 Dockerfile、`Dockerfile.gateway`、`Dockerfile.worker`，PR 只构建不推送。
- R3. 发布任务依赖同一质量门禁，三类镜像的命名、tag、缓存和多架构策略明确且可追踪。
- R4. `--if-present` 不得让应有测试或 lint 的逻辑包静默绕过门禁；无逻辑包的例外需显式记录。
- R5. 评估并收敛 Actions SHA、基础镜像 digest 和自动更新策略，避免无法维护的手工锁死。
- R6. 不在 workflow、日志或缓存中暴露 registry token、数据库凭据和本地环境文件。

## Acceptance Criteria

- [ ] PR 能稳定执行 lint、typecheck、测试和三制品构建且不推送镜像。
- [ ] Tag/手动发布只有在质量门禁通过后才推送预期镜像。
- [ ] Gateway/Worker 的 Dockerfile 失败会使 CI 明确失败。
- [ ] workflow 语法检查和一次可观察的 CI 运行通过；无法本地验证的外部设置被明确列出。

## Out Of Scope

- 假设或修改仓库外 GitHub branch protection，而不先核验权限与现状。
- 引入新的商业 CI 平台。
