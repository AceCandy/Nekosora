# CI 与制品质量门禁设计

## 1. 边界

本任务建立两条独立但一致的流水线：

1. `quality.yml`：PR 与 main push 的仓库质量和三制品构建门禁，不登录 Registry、不推送镜像。
2. `docker-publish.yml`：schedule、`v*` Tag 和手动发布；workflow 内先执行与 `quality.yml` 相同命令的 `quality` job，再构建并推送三类多架构镜像。

GitHub Actions 不能可靠地让一个触发中的 job 依赖另一个 workflow 的实时结果，因此不使用 `workflow_run` 拼接两个工作流。两个 workflow 复用仓库根脚本和同一份可执行 workspace 质量清单，避免复制业务判断；发布 job 通过 `needs: quality` 明确阻断推送。

## 2. 质量门禁

### 2.1 命令

两个 workflow 各有一个单独的 `quality` job，均使用 Node 22 与仓库 `packageManager` 指定的 pnpm，并在该 job 内依次执行完整清单：

1. `pnpm install --frozen-lockfile`
2. workspace 质量清单校验
3. `pnpm check`
4. `pnpm test`
5. `pnpm build`
6. `pnpm build:gateway`
7. `pnpm build:worker`

Node setup 使用 pnpm lockfile cache。workflow 不读取 `.env.local`，也不注入数据库或 Registry secret。

### 2.2 防静默绕过

增加一个根级 Node 脚本和测试，读取 `pnpm-workspace.yaml` 匹配到的 workspace manifest，并与显式策略清单对照：

- 所有 workspace 必须存在 `typecheck`。
- `gateway/web/worker` 必须有 `lint/typecheck/test/build`。
- `core/queue` 必须有 `typecheck/test`；其 lint 缺口在本任务中通过共享 package ESLint 配置补齐，避免继续把大型逻辑包列为例外。
- `contracts/db/observability` 必须有 `typecheck`，允许无测试，但例外原因写在策略清单中。
- 新增 workspace 未登记、要求脚本缺失、例外包突然新增测试却未更新策略时，校验失败。

不为无测试包添加成功即退出的假 `test` 脚本；那只会把静默绕过伪装成绿色。

## 3. Docker 构建

### 3.1 PR/main

`quality.yml` 的 Docker job 通过 `needs: quality` 依赖代码质量 job，成功后再通过 matrix 构建：

| component | file | image contract |
|---|---|---|
| web | `Dockerfile` | `nekusora-web` |
| gateway | `Dockerfile.gateway` | `nekusora-gateway` |
| worker | `Dockerfile.worker` | `nekusora-worker` |

平台固定 `linux/amd64`，`push: false`。三个 matrix 项任一失败即门禁失败。使用各 component 独立的 GHA cache scope，避免缓存互相覆盖。

### 3.2 发布

发布先通过质量 job，然后 matrix 构建三类 `linux/amd64,linux/arm64` 镜像：

- GHCR：`ghcr.io/<owner>/nekusora-web|gateway|worker`，每项必须成功。
- DockerHub：`docker.io/<DOCKERHUB_USERNAME>/nekusora-web|gateway|worker`，仅 `v*` Tag 且用户名/token 都存在时尝试。
- `v*` push Tag 生成 semver、`latest` 和 sha tag；schedule 与 workflow_dispatch 总是生成 sha tag，仅 checkout ref 为 main 时生成 `edge`。Tag 事件不生成 `edge`。
- DockerHub 只镜像 `v*` push Tag 对应的 semver、`latest` 和 sha tag，三类镜像的 tag 集合必须一致。
- 不再推送 `ghcr.io/<owner>/nekusora` 或 DockerHub `nekusora`。

DockerHub 可选同步不能和 GHCR 放在同一次多 Registry push 中，否则 DockerHub 失败会让 GHCR 的已成功结果和 job 状态耦合。发布依赖链固定为 `quality -> ghcr-publish matrix -> dockerhub-sync matrix`：GHCR matrix 不使用 `continue-on-error`，其聚合结果只有三项全部成功才允许下游执行，不新增空的 aggregate job。DockerHub job 使用普通 `needs: ghcr-publish` 和 `v*` push Tag 事件条件，不在 job 级使用 `always()`，因此质量或任一 GHCR component 失败/跳过时绝不尝试 DockerHub。

DockerHub secret 先映射到 job `env`，preflight step 只向 `$GITHUB_OUTPUT` 写用户名/token 是否非空的布尔值，不输出 secret 内容；后续条件只读取这些布尔 output。登录与同步步骤各自 `continue-on-error: true`，终结 summary step 才使用 `if: always()`，根据 step `outcome` 为每个 component 记录成功、缺凭据或失败，使可选 job 保持非阻断。另设无发布副作用的最终 summary job，以 `if: always()` 记录 GHCR 聚合结果，并在 schedule/manual 时写明 DockerHub 不适用。`workflow_dispatch` 即使选择 Tag ref 也不触发 DockerHub。

## 4. 触发、并发与权限

- `quality.yml`：`pull_request` + `push.branches: [main]`；权限只读 contents。
- `docker-publish.yml`：保留 schedule、`v*` Tag、workflow_dispatch；schedule 显式 checkout `main`。
- 发布 concurrency 以 ref/event 分组，`cancel-in-progress: false`，避免正在推送的版本被新运行中断；相同分组串行。
- schedule 更新检测只查询当前 workflow、schedule event 和 main；HTTP 非成功、JSON 解析失败或没有可比较 SHA 时都显式输出 `skip=false` 并继续构建，只有成功取得同一 workflow/main 上一次成功 schedule 的相同 SHA 才跳过。
- 移除未使用的 `id-token: write`，只在需要的 job 授予 `packages: write` 和 `actions: read`。

## 5. 供应链维护

- 所有 `uses:` 固定完整 commit SHA，行尾注释保留人类可读 major tag。
- 新增 `.github/dependabot.yml`，每周检查 `github-actions`；更新 PR 仍需通过本任务建立的质量门禁。
- workflow 语法校验复用一个最小 Linux amd64 脚本：固定 `actionlint` 版本与官方 release SHA-256，下载到临时目录、校验后运行，不建设跨平台安装器或升级框架。当前核验版本为 `v1.7.12`，`linux_amd64` archive SHA-256 为 `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`。
- 基础镜像当前继续使用 `node:22-alpine`、`pgvector/pgvector:pg16` 等既有可维护 tag，不在本任务一次性锁 digest。原因是仓库尚无自动 digest 更新和三架构 digest 校验机制；手工锁死会快速陈旧。基础镜像 digest 固定列为后续供应链任务，不伪装成本任务已解决。

## 6. 文档与兼容

- README Docker 部署示例改为三个新镜像，并明确旧 `nekusora` 地址停止更新。
- `compose.production.yml` 本地构建名已经与新命名一致；仅在文档中补充如何改成预构建镜像，不改变默认本地 build 行为。
- PR 模板自检从单一 `pnpm typecheck` 调整为 `pnpm check`、`pnpm test` 和受影响制品构建。

## 7. 验证与剩余风险

- 仓库内执行 workspace 策略测试、`pnpm check`、`pnpm test`、三个应用 build、三份 Dockerfile amd64 build、`git diff --check`。
- workflow YAML 使用固定版本和 SHA-256 的 actionlint 脚本做语法/表达式检查。验证时运行真实 happy path，并通过临时 `PATH` mock 让同一脚本分别收到下载失败和损坏 archive，断言均为非零退出；测试产物只放临时目录，不把测试开关做进生产脚本。
- GitHub-hosted runner、GHCR/DockerHub 权限、跨架构发布和 job summary 必须在推送后通过一次真实 PR/main 质量运行及一次实际手动或 Tag 发布观察；本任务不伪造不会推送的 manual dry-run。没有仓库外执行权限时必须明确列为未验证项。

回滚时可独立回退 `quality.yml`；发布失败则回退 `docker-publish.yml` 到上一版本。已推送的新镜像 tag 不自动删除，避免对 Registry 做不可逆清理。
