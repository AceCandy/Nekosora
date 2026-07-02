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
| [Database Guidelines](./database-guidelines.md) | Drizzle 双 dialect、查询模式、迁移、命名 | Filled |
| [Error Handling](./error-handling.md) | 统一 API 错误契约、ErrorCode、i18n、工具函数 | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

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
