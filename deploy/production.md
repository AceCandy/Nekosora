# 生产部署

生产编排使用 `compose.production.yml`，只有 `edge-router` 发布端口；Web、Gateway 和 Worker 端口仅在内部网络可见。
三个应用容器共用同一个 `nekusora` 镜像，通过各自的工作目录和启动命令运行独立进程。

## 从 PostgreSQL 16 升级

生产编排使用 `pgvector/pgvector:pg17`。PostgreSQL 17 不能直接读取 PostgreSQL 16 数据目录；已有部署必须在旧容器仍运行 PostgreSQL 16 时先完成备份，再按 PostgreSQL 官方流程使用 `pg_upgrade`，或把逻辑备份恢复到新的 PostgreSQL 17 数据目录。备份文件包含全部业务数据和密钥材料，必须保存在仓库外的受控位置。

不要直接用 PostgreSQL 17 启动现有 PostgreSQL 16 卷，也不要用 `down -v` 腾空数据库；本编排不会自动执行数据库大版本迁移。完成迁移并验证备份可恢复后，再执行下面的启动步骤。

## 首次启动

```bash
cp deploy/production.env.example deploy/production.env
# 编辑 deploy/production.env，使用强随机密钥和正式 BETTER_AUTH_URL
docker compose --env-file deploy/production.env -f compose.production.yml pull postgres redis edge-router
docker compose --env-file deploy/production.env -f compose.production.yml build --pull
docker compose --env-file deploy/production.env -f compose.production.yml up -d
docker compose --env-file deploy/production.env -f compose.production.yml ps
```

`edge-router` 的公开端口由 `APP_PORT` 设置。健康检查通过后，`/v1/*`、`/api/chat`、上传/文件/图片/知识搜索和 `/metrics` 进入 Gateway，其余页面、认证、静态资源和 Next 内部路径进入 Web。Gateway 与 Worker 使用同一个 `uploads` 卷；不要把 Worker 的 `LOCAL_STORAGE_DIR` 改成相对路径。

空库首次启动时只有 Web 创建首管理员；Gateway 和 Worker 仍执行连接检查与幂等迁移，但不参与 Better Auth 账号 seed，避免多进程并发创建同一账号。

## 连接预算与扩容

默认数据库连接预算为 Web 5、每个 Gateway 10、每个 Worker 5，再加 PostgreSQL/迁移和运维余量。扩容前确保 PostgreSQL `max_connections` 覆盖：

`5 * WEB_REPLICAS + 10 * GATEWAY_REPLICAS + 5 * WORKER_REPLICAS + 20`

可分别扩容 Gateway 和 Worker。edge 使用 Docker DNS 动态解析服务地址，扩容后最多等待 10 秒进入 upstream：

```bash
docker compose --env-file deploy/production.env -f compose.production.yml up -d --scale gateway=2 --scale worker=2
```

## 指标与回滚

`/metrics` 默认的 `127.0.0.1/32` 只允许 edge 容器自身访问。宿主机或其他容器中的 scraper 必须把 `METRICS_ALLOW_CIDR` 设置为 edge 实际看到的来源网段。发布前保留上一版应用镜像 tag 和对应 edge 配置。回滚时停止新 edge，恢复旧 edge 配置与应用镜像，再启动 Web、Gateway、Worker 和 edge；PostgreSQL、Redis 和上传卷保留，不执行破坏性迁移。

## 停止

```bash
docker compose --env-file deploy/production.env -f compose.production.yml down
```

Gateway/Worker 的停止宽限期为 35 秒，覆盖队列运行时的 30 秒 drain deadline。需要删除状态卷时必须显式执行 `down -v`，否则默认保留 PostgreSQL、Redis 和上传数据。
