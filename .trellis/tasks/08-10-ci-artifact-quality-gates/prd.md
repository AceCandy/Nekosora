# CI 与制品质量门禁

## Goal

让每个 PR 在合并前自动验证代码质量，并让统一生产镜像覆盖 Web、Gateway、Worker 三个独立容器入口。

## Background

- `.github/workflows/docker-publish.yml:12-17` 仅由定时、Tag 和手动触发，仓库内未见 PR 质量 workflow。
- 原发布流程只构建 Web 产物，Gateway 与 Worker 没有进入同一生产制品。
- 2026-08-12 真实多架构发布显示 QEMU arm64 安装依赖会非法指令崩溃；用户随后决定改为一个 `nekusora` 镜像承载三个容器入口，不再维护三份职责镜像。

## Requirements

- R1. PR 与 main push 至少运行冻结依赖安装、`pnpm check` 和 `pnpm test`，失败时阻止后续制品发布。
- R2. CI 显式验证统一 Dockerfile 同时包含 Web、Gateway、Worker 运行产物；PR 只构建 `linux/amd64` 且不推送。
- R2a. Tag、手动和定时发布分别在原生 amd64 与 arm64 Runner 构建平台 digest，两个平台都成功后才创建正式多架构标签；不得用 QEMU 执行生产依赖安装。
- R3. 发布 workflow 内置与 PR/main 一致的质量 job，并以 `needs` 阻断发布；GHCR 与 DockerHub 的唯一镜像名为 `nekusora`，tag、缓存和多架构策略明确且可追踪。
- R3a. GHCR 统一镜像是所有发布事件的必需结果；DockerHub 仅在 `v*` push Tag 且凭据可用时同步同一 manifest。符合条件但未配置或同步失败时不得阻断 GHCR，且必须在 GitHub Actions summary 中明确标记；schedule/manual 明确标记为不适用。
- R4. `--if-present` 不得让应有测试或 lint 的逻辑包静默绕过门禁；无逻辑包的例外需显式记录。
- R5. Actions 固定完整 commit SHA 并由 Dependabot 周更；评估基础镜像 digest 后明确本任务是否实施或延期，避免没有自动更新机制的手工锁死。
- R6. 不在 workflow、日志或缓存中暴露 registry token、数据库凭据和本地环境文件。
- R7. 统一镜像不得重复携带 Gateway 与 Worker 的完整 production 依赖仓库；两者仍需保留各自显式依赖边界。

## Acceptance Criteria

- [ ] PR 能稳定执行 lint、typecheck、测试和统一镜像构建且不推送镜像。
- [ ] Tag/手动/schedule 发布只有在质量 job 与两个原生平台构建通过后，才向 GHCR 创建统一双架构镜像标签。
- [ ] `v*` push Tag 的 DockerHub 同步成功、缺凭据和同步失败三种结果都可观察且不改变 GHCR 成败；schedule/manual 明确显示不适用。
- [x] 统一镜像缺少 Web、Gateway 或 Worker 任一运行产物会使构建或契约测试明确失败。
- [x] workflow、Compose 和 README 只引用 `nekusora`，并明确旧三镜像地址不再更新；三个服务仍为独立容器。
- [x] 本地 amd64 统一镜像不超过 `1.5 GB`，且 Gateway 与 Worker 都能从各自工作目录解析运行依赖。
- [ ] workflow 语法检查和一次可观察的 CI 运行通过；无法本地验证的外部设置被明确列出。

## Out Of Scope

- 假设或修改仓库外 GitHub branch protection，而不先核验权限与现状。
- 引入新的商业 CI 平台。
- 为旧 `nekusora-web`、`nekusora-gateway`、`nekusora-worker` 镜像继续推送兼容别名。
- 在没有自动 digest 更新机制前锁定 Docker 基础镜像 digest；该风险只记录并留给后续供应链任务。
