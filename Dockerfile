# Nekusora Dockerfile —— 多阶段构建。
# 默认 PostgreSQL 模式(生产推荐);SQLite 模式挂载 /app/data 卷。
# docker build -t nekusora . && docker run -p 3000:3000 -e DATABASE_URL=... nekusora

# ---- 构建阶段 ----
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# 安装依赖(利用 docker 层缓存)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

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

# 复制构建产物 + 必需文件
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# SQLite 数据卷 + 上传目录
RUN mkdir -p /app/data /app/uploads && chown -R nextjs:nodejs /app/data /app/uploads
VOLUME ["/app/data", "/app/uploads"]

USER nextjs
EXPOSE 3000

# standalone 模式由 next build 产出;如未启用 standalone,则用 next start
CMD ["node", "server.js"]
