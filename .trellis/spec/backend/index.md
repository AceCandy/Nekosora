# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

Nekusora 是 Next.js 全栈 TypeScript 项目,无独立后端进程(除 `src/worker.ts`)。服务端逻辑分布在 `app/`(路由/API/server actions)与 `lib/`(领域逻辑 + 基建)。本目录沉淀服务端**实际存在且稳定**的模式,不预设未来架构。已填充的条目见下表;标注 `To fill` 的代表当前尚未形成稳定约定,留待对应模式沉淀后再补。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | app/lib 分层、infra/providers/rag 等领域 | Filled |
| [Database Guidelines](./database-guidelines.md) | Drizzle PostgreSQL-only、动态 import 约束、查询/迁移/命名、向量 mock | Filled |
| [Error Handling](./error-handling.md) | 统一 API 错误契约、ErrorCode、i18n、工具函数 | Filled |
| [Auth Guidelines](./auth-guidelines.md) | Better Auth 配置、Origin 信任模型、dev 局域网联调 | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | 网关调用日志双表模型、logUsage 分流、TTFT、错误分类、数据层脱敏 | Filled |
| [Chat Generation Params](./chat-generation-params.md) | 会话级生成参数端到端契约 + reasoning providerOptions 映射 | Filled |
| [Provider Probe](./provider-probe.md) | key 连通性探测契约(/models 鉴权判定 + anthropic 混搭兼容) | Filled |
| [Gateway Routing](./gateway-routing.md) | 统一资源模型、resolveRoutes/resolveRoutesById 决策树、可见性四套场景、熔断 | Filled |
| [Memory System](./memory-system.md) | 三分类生命周期、抽取去重(explicit/weak)、融合向量召回、compact 质量增强、缓存 | Filled |
| [Prompt Caching](./prompt-caching.md) | 命中前提、AI SDK 边界、按 protocol 注入缓存控制(复刻 pi) | Filled |
| [Web Search](./web-search.md) | per-user 配置(user_settings JSON)、首个 enabled 生效、provider 字段契约、缓存 | Filled |
| [File Storage](./file-storage.md) | StorageDriver 全量/Range 读取、私有文件 200/206/302/416 与文本预览有界读取 | Filled |
| [Dependency Security](./dependency-security.md) | pnpm override 边界、lockfile 审查与原生依赖验证门禁 | Filled |
| [MCP Integration](./mcp-integration.md) | MCP client transport 连接超时、取消与资源生命周期 | Filled |
| [Chat Message References](./chat-message-references.md) | 对话消息引用与聊天动作写操作的会话属主隔离 | Filled |

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
