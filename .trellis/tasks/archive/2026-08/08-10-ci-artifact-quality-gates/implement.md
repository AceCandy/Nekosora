# CI 与制品质量门禁实施计划

## 1. 可执行 workspace 门禁

- [x] 先写策略测试：枚举所有 workspace，验证每个包已登记且必需脚本存在，明确 `contracts/db/observability` 无测试例外。
- [x] 增加最小策略脚本与根命令；新增或遗漏 workspace 时必须失败。
- [x] 为共享 packages 建立适用的 ESLint flat config，并给 `core/queue` 增加真实 lint 脚本；不得复用 Web 的浏览器/React 规则。
- [x] 更新根脚本，保留开发者现有命令兼容，同时让 CI 显式运行策略校验、check 和 test。

验证：策略单测覆盖未知包、缺脚本、合法例外、例外包新增测试四种场景；`pnpm check`、`pnpm test`。

## 2. PR/main 质量 Workflow

- [x] 增加最小 Linux amd64 `actionlint` wrapper，固定 `v1.7.12` 与官方 archive SHA-256，只下载到临时目录并在执行前校验；不建设跨平台安装器。
- [x] 新增 `.github/workflows/quality.yml`，触发 PR 与 main push。
- [x] 单个 quality job 使用冻结安装、pnpm cache，并在该 job 内依次执行 workspace 策略、actionlint、`pnpm check`、`pnpm test`、`pnpm build`、`pnpm build:gateway`、`pnpm build:worker`。
- [x] Docker job 以 `needs: quality` 在代码门禁成功后构建统一 `linux/amd64` 镜像，`push: false`。
- [x] 设置最小 permissions 与可取消的 PR/main concurrency。

验证：actionlint wrapper 的真实 happy path；用临时 `PATH` mock 验证下载失败和损坏 archive 均非零退出；全部 workflow actionlint；静态断言 `quality -> Docker build`；三个应用 build；统一镜像本地 amd64 build。

## 3. 统一制品发布 Workflow

- [x] 重构 `docker-publish.yml`，在同一 workflow 内执行完整 `quality -> native GHCR platform builds -> manifest publish -> DockerHub sync`，不得依赖另一个 workflow 的运行结果。
- [x] schedule 显式 main，并将跳过查询限定到当前 workflow、schedule event 和 main；HTTP、JSON 或空结果异常都显式输出 `skip=false` 并继续构建。
- [x] GHCR 强制通过原生 amd64/arm64 Runner 推送 `nekusora` 平台 digest，两个平台成功后原子创建双架构 manifest。
- [x] 标签按事件拆分：`v*` push Tag 使用 semver/latest/sha，schedule/manual 使用 sha 且仅 main 生成 edge；静态断言不存在旧三镜像 target。
- [x] DockerHub 独立 job 使用普通 `needs: ghcr-publish`，且条件显式包含 `github.event_name == 'push'`、`github.ref_type == 'tag'` 与 `startsWith(github.ref_name, 'v')`；secret 经 job env 进入 preflight，preflight 只输出存在性布尔值。登录/复制 step 容错，只有 summary step 使用 `if: always()`，分别明示成功、缺凭据或失败；最终无副作用 summary 在 schedule/manual 明示不适用。
- [x] 设置串行发布 concurrency、最小权限、分架构 cache scope、明确超时和统一 digest summary。
- [x] 所有 Actions 固定完整 SHA，新增 Dependabot `github-actions` 周更。

验证：actionlint；静态断言原生 runner 矩阵、digest 合并、`quality -> ghcr-build -> ghcr-publish -> dockerhub-sync`、DockerHub job 不使用 `always()`、secret 不直接出现在 `if`、schedule 查询失败为 `skip=false`、workflow_dispatch 选择 Tag 仍不触发 DockerHub；真实 GitHub 运行留作外部验收。

## 4. 文档与供应链边界

- [x] 更新 README 统一镜像拉取/本地运行示例和旧三镜像停止更新提示。
- [x] 更新 PR 模板质量清单。
- [x] 记录基础镜像继续使用可维护 tag、未锁 digest 的剩余风险，不扩大为基础镜像供应链重构。
- [x] 更新 CI/发布所属 `.trellis/spec/`，沉淀触发、权限、SHA、命名与 workspace 策略契约。

## 5. 质量门禁

- [x] workspace 策略定向测试。
- [x] actionlint 对全部 workflow 通过。
- [x] `pnpm install --frozen-lockfile`。
- [x] `pnpm check`。
- [x] `pnpm test`。
- [x] `pnpm build`。
- [x] `pnpm build:gateway`。
- [x] `pnpm build:worker`。
- [x] `docker build --platform linux/amd64 -f Dockerfile .`。
- [x] `git diff --check` 与 Trellis task validate。
- [x] 独立复核权限、触发条件、Registry 失败语义、matrix 覆盖、secret 泄漏和文档迁移。
- [ ] 推送后观察一次真实 PR/main 质量运行与一次统一镜像手动或 Tag 发布；先前手动运行 `31581714148` 暴露 QEMU arm64 非法指令并被取消，不算通过。

- [x] 用 workspace 外的 frozen production manifest 替代两份独立 `pnpm deploy`，让 Gateway 与 Worker bundle 共享同一依赖图，并隔离 Web/测试 peer。
- [x] 本地 amd64 镜像实测 `491,891,475` bytes（约 `492 MB`）；上一版过滤 workspace 镜像为 `1.22 GB`，减少约 60%，旧三份制品方案为 `2.41 GB`。
- [x] 三个入口、非 root UID 及 Gateway/Worker 的 S3、队列、MCP、mem0、音频元数据和 sharp 动态/原生依赖解析通过。
- [x] runtime 锁确认不含 Next/SWC、Vitest/Vite/esbuild、`pdfjs-dist`、Natural/WordNet/Compromise；`pnpm check`、`pnpm test` 与最终独立复核通过。

## 6. 回滚点

- workspace 策略与 lint 脚本可独立回滚，不影响应用运行时。
- `quality.yml` 可独立移除；分支保护属于仓库外设置，不在本任务自动改动。
- 发布 workflow 回退不会删除已推送镜像；旧三镜像地址停止更新是已批准的破坏性变更，不在回滚中恢复兼容别名。
- 未在本地验证 GitHub-hosted runner、Registry权限、DockerHub可选失败 summary 和真实双架构 push，必须在首次发布前观察验证。
