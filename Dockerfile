# Nekusora unified production image for Web, Gateway, and Worker containers.
# docker build -t nekusora . && docker run -p 3000:3000 -e DATABASE_URL=... nekusora

# ---- 构建阶段 ----
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# 安装依赖(利用 docker 层缓存)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/web/package.json ./apps/web/
# postinstall 依赖此脚本(同步 pdfjs cmaps/fonts 到 public),需在 install 前复制进镜像
COPY apps/web/scripts/sync-pdfjs-assets.cjs ./apps/web/scripts/
COPY apps/worker/package.json ./apps/worker/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/observability/package.json ./packages/observability/
COPY packages/queue/package.json ./packages/queue/
COPY deploy/runtime/package.json deploy/runtime/pnpm-lock.yaml deploy/runtime/.npmrc ./deploy/runtime/
RUN pnpm install --frozen-lockfile && \
    pnpm --dir deploy/runtime fetch --prod --frozen-lockfile --ignore-workspace

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && \
    pnpm build:gateway && \
    pnpm build:worker

# Gateway 与 Worker 的 bundle 共享一份隔离的 production 依赖图。
FROM builder AS runtime-deps
RUN mkdir -p /runtime/apps/gateway /runtime/apps/worker && \
    cp deploy/runtime/package.json deploy/runtime/pnpm-lock.yaml deploy/runtime/.npmrc /runtime/ && \
    cd /runtime && pnpm install --prod --offline --frozen-lockfile && \
    cp -R /app/apps/gateway/dist /runtime/apps/gateway/ && \
    cp -R /app/apps/worker/dist /runtime/apps/worker/ && \
    node --check /runtime/apps/gateway/dist/main.js && \
    node --check /runtime/apps/worker/dist/main.js && \
    cd /runtime/apps/gateway && node -e "import('mem0ai/oss')" && \
    cd /runtime/apps/worker && node -e "import('mem0ai/oss')"

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV GATEWAY_HOST=0.0.0.0
ENV GATEWAY_PORT=4000
ENV WORKER_HEALTH_HOST=0.0.0.0
ENV WORKER_HEALTH_PORT=4001
ENV DRIZZLE_MIGRATIONS_DIR=/app/drizzle/pg
ENV LOCAL_STORAGE_DIR=/app/uploads

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nekusora

# standalone 保留 monorepo 目录结构。
COPY --from=builder --chown=nekusora:nodejs /app/apps/web/.next/standalone /app
COPY --from=builder --chown=nekusora:nodejs /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=builder --chown=nekusora:nodejs /app/apps/web/public /app/apps/web/public
COPY --from=runtime-deps --chown=nekusora:nodejs /runtime /app/runtime
COPY --from=builder --chown=nekusora:nodejs /app/drizzle /app/drizzle

RUN cd /app/apps/web/.next/server/chunks && \
    node -e "const { readdirSync } = require('node:fs'); const names = readdirSync('../../node_modules').filter((entry) => entry.startsWith('mem0ai-')); if (names.length !== 1) throw new Error('Expected one Next mem0 external alias'); import(names[0] + '/oss').then(({ Memory }) => { if (typeof Memory !== 'function') throw new Error('Memory export missing') })"
RUN mkdir -p /app/uploads && chown -R nekusora:nodejs /app/uploads
VOLUME ["/app/uploads"]

USER nekusora
WORKDIR /app/apps/web
EXPOSE 3000 4000 4001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# standalone 模式由 next build 产出;如未启用 standalone,则用 next start
CMD ["node", "server.js"]
