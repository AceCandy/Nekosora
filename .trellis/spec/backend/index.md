# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

Nekusora is a pnpm TypeScript workspace. `apps/web` is the Next.js control plane, while `apps/gateway` is an independently runnable Fastify data plane. Framework-neutral HTTP and domain logic lives in workspace packages. The legacy Worker entry remains under Web until the worker-boundary task moves it into its own application.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | app/lib 分层、infra/providers/rag 等领域 | Filled |
| [Database Guidelines](./database-guidelines.md) | Drizzle PostgreSQL-only、动态 import 约束、查询/迁移/命名、向量 mock | Filled |
| [Queue And Worker Lifecycle](./queue-lifecycle.md) | typed job catalog、pg-boss generation、recovery scheduler、shutdown drain | Filled |
| [Error Handling](./error-handling.md) | 统一 API 错误契约、ErrorCode、i18n、工具函数 | Filled |
| [Auth Guidelines](./auth-guidelines.md) | Better Auth 配置、Origin 信任模型、dev 局域网联调 | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | 网关调用日志双表模型、logUsage 分流、TTFT、错误分类、数据层脱敏 | Filled |
| [Chat Generation Params](./chat-generation-params.md) | WebChat 默认生成参数边界 + reasoning providerOptions 映射 | Filled |
| [Chat Run Metadata](./chat-run-metadata.md) | assistant run 的完成时序、SSE/历史投影、隐私与迁移契约 | Filled |
| [Provider Probe](./provider-probe.md) | key 连通性探测契约(/models 鉴权判定 + anthropic 混搭兼容) | Filled |
| [Gateway Runtime](./gateway-runtime.md) | Fastify adapter, route ownership, readiness, build and startup contracts | Filled |
| [Gateway Routing](./gateway-routing.md) | 统一资源模型、resolveRoutes/resolveRoutesById 决策树、可见性四套场景、熔断 | Filled |
| [Memory System](./memory-system.md) | 三分类生命周期、抽取去重(explicit/weak)、融合向量召回、compact 质量增强、缓存 | Filled |
| [Prompt Caching](./prompt-caching.md) | 命中前提、AI SDK 边界、按 protocol 注入缓存控制(复刻 pi) | Filled |
| [Model Message Boundary](./model-message-boundary.md) | OpenAI IR 到 AI SDK ModelMessage 的多模态与工具消息转换契约 | Filled |
| [Web Search](./web-search.md) | per-user V2 有序后端、按需逻辑工具、Hosted Search、安全与历史恢复 | Filled |
| [Link Preview](./link-preview.md) | 登录态外链元数据、裸图片 MIME 探测、受限图片代理与公网请求边界 | Filled |
| [File Storage](./file-storage.md) | StorageDriver 全量/Range 读取、私有文件 200/206/302/416 与文本预览有界读取 | Filled |
| [Dependency Security](./dependency-security.md) | pnpm override 边界、lockfile 审查与原生依赖验证门禁 | Filled |
| [MCP Integration](./mcp-integration.md) | MCP client transport 连接超时、取消与资源生命周期 | Filled |
| [Chat Message References](./chat-message-references.md) | 对话消息引用与聊天动作写操作的会话属主隔离 | Filled |
| [Chat Message Attachments](./chat-message-attachments.md) | 用户消息图片关联、校验顺序、历史投影与编辑/重试契约 | Filled |
| [Conversation Sharing](./conversation-sharing.md) | 快照/实时分享、密码解锁、版本选择与公开读取边界 | Filled |
| [API Key Binding Authorization](./key-binding-authorization.md) | 子密钥模型绑定的 key 属主与模型可见性校验 | Filled |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
