# 网关运行时分离与 Next 16 升级

## Goal

将 Nekusora 从单一 Next.js 全栈进程重构为可独立部署的 Web 控制面、模型网关和异步 Worker，同时升级到稳定的 Next.js 16 并以 Turbopack 作为默认打包器。核心价值是隔离 UI、API 网关和后台任务的故障与扩缩容边界，并从结构上消除 Next 打包器对 `pg-boss` 等 Node-only 依赖的错误分析。

## Background

- 当前仓库是单 package 的 Next.js 15.5.21 App Router 应用，`/api/*`、`/v1/*`、页面和 Server Actions 共用 Next 进程，另有 `src/worker.ts` 独立进程。
- 当前 `src/lib/infra/queue.ts` 使用变量路径动态导入 `pg-boss`；Webpack 已报告 `Critical dependency`，生成的开发产物无法静态解析该模块。
- 用户已确认目标架构：Next.js 16 + Turbopack Web、独立 Node.js/Fastify Gateway、独立 Node.js/pg-boss Worker，并在同一 monorepo 中共享领域逻辑和契约。
- 迁移必须保持现有对外行为兼容；内部目录、构建和部署方式可以调整。

## Requirements

- R1. 将仓库组织为 pnpm workspace，至少包含 `apps/web`、`apps/gateway`、`apps/worker` 以及必要且实际共享的 packages；不得为单一实现创建空壳抽象。
- R2. Web 应用升级到实施时确认的稳定 Next.js 16 版本，开发与生产构建默认使用 Turbopack；Webpack 仅保留为诊断回退路径。
- R3. 完整数据面由独立 Fastify Gateway 提供：`/v1/*`、`/api/chat`、`/api/upload`、`/api/files/*`、`/api/images*`、`/api/knowledge/search` 与数据面指标；Better Auth、页面、管理后台、用户面板和控制面 Server Actions 保留在 Next。
- R4. Gateway 保持现有请求路径、鉴权语义、错误契约、SSE 帧格式、取消行为、用量记录、模型路由和故障转移行为。
- R5. Worker 作为独立 Node.js 进程继续消费 pg-boss 任务，保留现有 typed catalog、幂等、重试、恢复扫描和优雅关闭语义。
- R6. `pg-boss`、队列适配器及其他仅供数据面/Worker 使用的 Node-only 依赖不得进入 Web 的 Next/Turbopack依赖图；使用可静态解析的模块边界，不保留变量路径导入规避打包器。
- R7. Web、Gateway、Worker 复用同一份模型路由、provider IR、reasoning、错误码和数据库契约，避免迁移后形成平行实现。
- R8. 保持 PostgreSQL 数据和现有 Drizzle 迁移兼容；本次不更换数据库、队列、认证产品、对象存储或缓存产品。
- R9. 提供本地开发和生产容器编排，使 Web、Gateway、Worker 能独立启动、健康检查、停止和扩缩容，并保持用户可见 URL 不变。
- R10. 迁移采用可回滚顺序；每个阶段都必须有可执行验证，不允许一次性删除旧入口后再验证新入口。
- R11. Web、Gateway、Worker 分别暴露或提供可执行的存活/就绪检查；数据库连接池预算按进程拆分后仍不得超过 PostgreSQL 安全余量。

## Acceptance Criteria

- [x] AC1. workspace 的锁文件、脚本和依赖边界一致，干净环境可安装并构建全部应用。
- [x] AC2. Web 使用稳定 Next.js 16 和默认 Turbopack完成开发启动与生产构建，构建日志无 `Critical dependency`、`MODULE_NOT_FOUND` 或 Node-only依赖进入 Edge 图的错误。
- [x] AC3. 现有 `/v1/models`、聊天、图像、语音和 MCP 网关契约测试在独立 Gateway 上通过。
- [x] AC4. WebChat `/api/chat` 的 session 鉴权、SSE 事件序列、客户端取消、最终落库和历史恢复测试通过，前端无需更改公开调用 URL。
- [x] AC5. Gateway 与 Web 可独立停止和启动；Web 控制面故障不终止已运行的网关进程，Gateway 可独立扩容。
- [x] AC6. Worker 的队列生命周期、三类任务注册、重试、恢复和关闭 drain 测试通过。
- [x] AC7. Next Web 构建产物不包含 `pg-boss` 队列实现，Gateway/Worker 能用普通静态或字面量导入正常加载它。
- [x] AC8. Docker/本地编排能启动 Web、Gateway、Worker、PostgreSQL 和 Redis；健康检查能区分各进程状态。
- [x] AC9. 全量 lint、typecheck、单元测试、关键集成测试和生产构建通过；迁移前后的公共 HTTP 契约有自动化回归对照。
- [x] AC10. 文档准确描述新架构、启动命令、端口、反向代理边界和回滚方式，不再将实际未使用的打包器写为当前技术栈。
- [x] AC11. 上传、本地文件读取与 Worker 处理共享同一持久卷；S3/R2/MinIO 模式保持现有私有读取与签名 URL 语义。

## Out of Scope

- 不把 Gateway 进一步拆成 provider、鉴权、用量等多个微服务。
- 不迁移到 Vite、Go、Rust、NestJS 或其他全栈框架。
- 不更换 PostgreSQL、Redis、pg-boss、Better Auth、Drizzle、S3兼容存储或现有模型供应商 SDK。
- 不改变公共 API 产品能力、UI 设计或数据库业务模型，除非是保持新运行边界所必需的兼容迁移。
