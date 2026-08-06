# 生产部署

生产编排使用 `compose.production.yml`，只有 `edge-router` 发布端口；Web、Gateway 和 Worker 端口仅在内部网络可见。

## 首次启动

```bash
cp deploy/production.env.example deploy/production.env
# 编辑 deploy/production.env，使用强随机密钥和正式 BETTER_AUTH_URL
docker compose --env-file deploy/production.env -f compose.production.yml build
docker compose --env-file deploy/production.env -f compose.production.yml up -d
docker compose --env-file deploy/production.env -f compose.production.yml ps
```

`edge-router` 的公开端口由 `APP_PORT` 设置。健康检查通过后，`/v1/*`、`/api/chat`、上传/文件/图片/知识搜索和 `/metrics` 进入 Gateway，其余页面、认证、静态资源和 Next 内部路径进入 Web。Gateway 与 Worker 使用同一个 `uploads` 卷；不要把 Worker 的 `LOCAL_STORAGE_DIR` 改成相对路径。

## 连接预算与扩容

默认数据库连接预算为 Web 5、每个 Gateway 10、每个 Worker 5，再加 PostgreSQL/迁移和运维余量。扩容前确保 PostgreSQL `max_connections` 覆盖：

`5 * WEB_REPLICAS + 10 * GATEWAY_REPLICAS + 5 * WORKER_REPLICAS + 20`

可分别扩容 Gateway 和 Worker。edge 使用 Docker DNS 动态解析服务地址，扩容后最多等待 10 秒进入 upstream：

```bash
docker compose --env-file deploy/production.env -f compose.production.yml up -d --scale gateway=2 --scale worker=2
```

## 指标与回滚

`/metrics` 默认只允许 edge 所在主机的回环地址；容器化 scraper 必须把 `METRICS_ALLOW_CIDR` 设置为其实际来源网段。发布前保留上一版 Web 镜像 tag 和对应 edge 配置。回滚时停止新 edge，恢复旧 edge 配置与 Web 镜像，再启动旧 Web；数据库和队列卷保留，不执行破坏性迁移。

## 停止

```bash
docker compose --env-file deploy/production.env -f compose.production.yml down
```

Gateway/Worker 的停止宽限期为 35 秒，覆盖队列运行时的 30 秒 drain deadline。需要删除状态卷时必须显式执行 `down -v`，否则默认保留 PostgreSQL、Redis 和上传数据。
