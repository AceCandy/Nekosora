# CI 与制品门禁证据

> 第 3-27 行记录本任务实施前的仓库快照，用于说明改造依据；当前实现与决策见后续任务文档及所属 spec。

## 变更前 Workflow

- 仓库只有 `.github/workflows/docker-publish.yml`。
- 触发器只有每 12 小时 schedule、`v*` Tag 和手动触发，没有 PR 或 main push 质量检查。
- 发布 workflow 没有安装依赖、lint、typecheck 或测试 job，直接构建并推送镜像。
- `docker/build-push-action` 只使用根构建上下文且未指定 `file`，所以只构建根 `Dockerfile`；`Dockerfile.gateway` 和 `Dockerfile.worker` 未进入发布。
- schedule 的“最近成功提交”查询没有限定当前 workflow 或 main，可能读到其他成功运行。
- workflow 没有 concurrency；未使用的 `id-token: write` 扩大了权限。
- 所有 Action 都使用可变 major tag，没有固定到 commit SHA。

## 变更前 Workspace 质量覆盖

- 根 `lint/typecheck/test` 都使用 `pnpm -r --if-present`。
- `gateway/web/worker` 有 lint、typecheck、test、build。
- `core/queue` 有 typecheck 和 test，但没有 lint。
- `contracts/db/observability` 只有 typecheck，当前没有测试；三者分别是共享契约、Drizzle schema/连接薄层、单入口指标薄层。
- 所有 workspace 都有 typecheck；根 `build` 只构建 Web，另有 `build:gateway`、`build:worker`。
- 当前没有 actionlint/yamllint 等仓库内 workflow 语法工具。

## 变更前 Docker 制品

- 三份 Dockerfile 都以仓库根为构建上下文，内部使用冻结 lockfile 安装。
- 根 `Dockerfile` 构建 Next standalone Web；Gateway/Worker 分别通过 tsup + `pnpm deploy --prod --legacy` 构建独立 Node 镜像。
- 三镜像构建阶段不需要数据库或 Provider 密钥；运行健康检查需要数据库、认证密钥和数据加密密钥。
- `compose.production.yml` 已使用本地名 `nekusora-web`、`nekusora-gateway`、`nekusora-worker`，可作为发布命名依据。

## 已确认决策

- 本节原三镜像决策已在 2026-08-12 真实发布验收后被用户明确替代。
- GHCR 与 DockerHub 统一使用单一 `nekusora` 镜像，Web、Gateway、Worker 仍作为三个独立容器运行。
- 不继续推送旧 `nekusora-web`、`nekusora-gateway`、`nekusora-worker` 镜像；README 必须说明迁移。
- GHCR 统一镜像为发布硬条件；DockerHub 仅在 `v*` Tag 且凭据可用时复制同一 manifest，失败写入 job summary 但不阻断 GHCR。
- PR/main 只构建 `linux/amd64` 统一镜像且不推送；发布在原生 amd64 与 arm64 Runner 分别构建后合并 manifest。
- Action 固定到完整 commit SHA，并由 Dependabot `github-actions` 周更维护。

## Action SHA 核验（2026-08-12）

通过 GitHub refs API 核对当前正式 major tag：

| Action | Tag | Commit |
|---|---|---|
| `actions/checkout` | `v4` | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node` | `v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `pnpm/action-setup` | `v4` | `b906affcce14559ad1aafd4ab0e942779e9f58b1` |
| `docker/setup-qemu-action` | `v3` | `c7c53464625b32c7a7e944ae62b3e17d2b600130` |
| `docker/setup-buildx-action` | `v3` | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` |
| `docker/login-action` | `v3` | `c94ce9fb468520275223c153574b00df6fe4bcc9` |
| `docker/metadata-action` | `v5` | `c299e40c65443455700f0fdfc63efafe5b349051` |
| `docker/build-push-action` | `v6` | `10e90e3645eae34f1e60eeb005ba3a3d33f178e8` |

GitHub 官方 docs 仓库确认 Dependabot 配置使用 `package-ecosystem: "github-actions"`、`directory: "/"` 即可扫描 `.github/workflows`。

## actionlint 核验（2026-08-12）

- `rhysd/actionlint` 当前 release 为 `v1.7.12`；官方 checksum 文件中 `actionlint_1.7.12_linux_amd64.tar.gz` 的 SHA-256 为 `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`。
- `raven-actions/actionlint@v2` 当前 tag commit 为 `3d39aea434753780c3b3d4a1a31c854b4dbf49d7`，但其 composite Action 下载 actionlint archive 后未校验官方 checksum，因此本任务不采用该第三方 Action。
- 最小方案是在仓库内保留一个仅服务 GitHub Linux amd64 runner 的固定版本 wrapper；不增加跨平台安装器或自动升级框架。
