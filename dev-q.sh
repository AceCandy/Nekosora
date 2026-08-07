#!/usr/bin/env bash

# 启动 pg-boss 队列 worker(消费 file-process / memory-extract)。
# 需另开终端与 dev.sh、dev-w.sh 并行运行;依赖 .env.local 的 DATABASE_URL。
WORKER_HEALTH_PORT=3501 pnpm worker
