# 生产部署

生产编排提供两个可独立启动的文件：`compose.production.yml` 自带 PostgreSQL/Redis，`compose.production.external.yml` 连接外部 PostgreSQL/Redis。两种模式都只有 `edge-router` 发布端口；Web、Gateway 和 Worker 端口仅在内部网络可见。
三个应用容器共用同一个 `nekusora` 镜像，通过各自的工作目录和启动命令运行独立进程。

## 从 PostgreSQL 16 升级

内置编排 `compose.production.yml` 使用 `pgvector/pgvector:pg17`。PostgreSQL 17 不能直接读取 PostgreSQL 16 数据目录；已有内置部署必须在旧容器仍运行 PostgreSQL 16 时先完成备份，再按 PostgreSQL 官方流程使用 `pg_upgrade`，或把逻辑备份恢复到新的 PostgreSQL 17 数据目录。备份文件包含全部业务数据和密钥材料，必须保存在仓库外的受控位置。外接模式的版本升级和备份由外部数据库运维流程负责。

不要直接用 PostgreSQL 17 启动现有 PostgreSQL 16 卷，也不要用 `down -v` 腾空数据库；本编排不会自动执行数据库大版本迁移。完成迁移并验证备份可恢复后，再执行下面的启动步骤。

## 首次启动

```bash
cp deploy/production.env.example deploy/production.env
# 编辑 deploy/production.env，使用强随机密钥、正式 BETTER_AUTH_URL 和需要部署的 IMAGE_TAG
docker compose --env-file deploy/production.env -f compose.production.yml up -d --pull always --no-build
docker compose --env-file deploy/production.env -f compose.production.yml ps
```

Web、Gateway 和 Worker 默认从 `ghcr.io/acecandy/nekusora` 拉取同一 `IMAGE_TAG`。生产环境应固定版本标签；只有明确接受滚动更新时才使用 `latest`。

`edge-router` 的公开端口由 `APP_PORT` 设置。健康检查通过后，`/v1/*`、`/api/chat`、上传/文件/图片/知识搜索和 `/metrics` 进入 Gateway，其余页面、认证、静态资源和 Next 内部路径进入 Web。Gateway 与 Worker 使用同一个 `uploads` 卷；不要把 Worker 的 `LOCAL_STORAGE_DIR` 改成相对路径。

空库首次启动时只有 Web 创建首管理员；Gateway 和 Worker 仍执行连接检查与幂等迁移，但不参与 Better Auth 账号 seed，避免多进程并发创建同一账号。

## 外接 PostgreSQL 与 Redis

已有 PostgreSQL/Redis 时，将 `DATABASE_URL`、`REDIS_URL` 改为容器可访问的外部地址，然后直接使用外接版 Compose：

```dotenv
DATABASE_URL=postgresql://nekusora:url-encoded-password@db.internal:5432/nekusora
REDIS_URL=redis://:url-encoded-password@redis.internal:6379/0
```

```bash
docker compose --env-file deploy/production.env -f compose.production.external.yml up -d --pull always --no-build
```

容器中的 `127.0.0.1` 指向容器自身，不能用来连接宿主机服务；请使用容器可达的内网地址。外部 PostgreSQL 必须提供 pgvector，应用账号需要具备迁移权限，或由 DBA 预先创建扩展并应用迁移。外接版 Compose 不读取 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`。外部 Redis 使用 TLS 时将连接串协议改为 `rediss://`。

## 连接预算与扩容

默认数据库连接预算为 Web 5、每个 Gateway 10、每个 Worker 5，再加 PostgreSQL/迁移和运维余量。扩容前确保 PostgreSQL `max_connections` 覆盖：

`5 * WEB_REPLICAS + 10 * GATEWAY_REPLICAS + 5 * WORKER_REPLICAS + 20`

可分别扩容 Gateway 和 Worker。edge 使用 Docker DNS 动态解析服务地址，扩容后最多等待 10 秒进入 upstream：

```bash
docker compose --env-file deploy/production.env -f compose.production.yml up -d --scale gateway=2 --scale worker=2
```

外接 PostgreSQL/Redis 时将文件名替换为 `compose.production.external.yml`。

## 指标与回滚

`/metrics` 默认的 `127.0.0.1/32` 只允许 edge 容器自身访问。宿主机或其他容器中的 scraper 必须把 `METRICS_ALLOW_CIDR` 设置为 edge 实际看到的来源网段。发布前保留上一版应用镜像 tag 和对应 edge 配置。回滚时把 `IMAGE_TAG` 改回上一版本并重新执行带 `--pull always --no-build` 的启动命令；PostgreSQL、Redis 和上传卷保留，不执行破坏性迁移。

## 停止

```bash
docker compose --env-file deploy/production.env -f compose.production.yml down
```

外接 PostgreSQL/Redis 时将文件名替换为 `compose.production.external.yml`。Gateway/Worker 的停止宽限期为 35 秒，覆盖队列运行时的 30 秒 drain deadline。需要删除状态卷时必须显式执行 `down -v`，否则默认保留 PostgreSQL、Redis 和上传数据。
