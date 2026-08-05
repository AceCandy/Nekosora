# Nekusora Web Dockerfile —— 多阶段构建。
# docker build -t nekusora . && docker run -p 3000:3000 -e DATABASE_URL=... nekusora

# ---- 构建阶段 ----
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# 安装依赖(利用 docker 层缓存)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
# postinstall 依赖此脚本(同步 pdfjs cmaps/fonts 到 public),需在 install 前复制进镜像
COPY apps/web/scripts/sync-pdfjs-assets.cjs ./apps/web/scripts/
RUN pnpm install --frozen-lockfile

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# standalone 保留 monorepo 目录结构。
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public /app/apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle /app/drizzle

# 上传目录
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads
VOLUME ["/app/uploads"]

USER nextjs
WORKDIR /app/apps/web
EXPOSE 3000

# standalone 模式由 next build 产出;如未启用 standalone,则用 next start
CMD ["node", "server.js"]
