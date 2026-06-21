<div align="center">

# Nekusora · 星枢

**AI 聊天工作台 + OpenAI 兼容模型网关**

「猫与星空」的治愈感 × 「高可用网关」的精密工程 — 一个融合 claude.ai / chatgpt 式对话体验与 sub2api / CLIProxyAPI 式 API 网关的混合型全栈平台。

[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js%2015-App%20Router-000000.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg)](https://www.typescriptlang.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle%20ORM-PG%20%2F%20SQLite-d6f334.svg)](https://orm.drizzle.team/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-f59e0b.svg)](.)

**设计主线 · 星枢天流 (The Astral Skyline)** — 暮色微澜黑与星云纯白

</div>

---

## 概述

Nekusora(星枢,取自 Neku 猫 / Sora 天空)把两件事揉进了同一个产品里:

1. **AI 聊天工作台** —— 类 claude.ai / chatgpt 的流式对话界面,面向终端用户与提示词工程师。
2. **OpenAI 兼容模型网关** —— 通过 `base_url + sk-*` 接入,带**主-子密钥层级**、**每子密钥双来源模型绑定**、加权负载均衡与故障转移,面向开发者与团队。

现有 OpenAI SDK 客户端可**零改动**接入网关,只需替换 `base_url` 与 `api_key`。

---

## ✨ 特性

### AI 聊天工作台
- 流式对话(SSE)、多模型选择、多会话管理
- CJK 感知的 token 估算 + 上下文窗口裁剪(防止历史过长)
- 全局模型 + 用户 BYO 模型统一选择
- **Artifacts**:代码 / 文档类回答的可视化渲染面板
- **会话分享**:生成只读分享链接(`/share/:id`)
- **多模态**:图片输入、文件上传与解析
- **记忆 (Memory)**:长期用户画像与偏好记忆
- **RAG**:基于 pgvector / sqlite-vec 的检索增强
- **Prompt 模板**:可复用的对话模板库

### OpenAI 兼容 API 网关
- `POST /v1/chat/completions`(流式 + 非流式,严格 OpenAI 格式)
- `POST /v1/images/generations` —— 图像生成
- `POST /v1/audio/speech` —— TTS 语音合成
- `POST /v1/audio/transcriptions` —— 语音转写
- `POST /v1/mcp` —— MCP(Model Context Protocol)桥接端点
- `GET /v1/models`(返回该 key 可用模型)
- 加权负载均衡 + 故障转移(多上游路由)

### 主-子密钥层级
- **主 Key**(每用户唯一):可直接调用,无模型绑定限制
- **子 Key**(多个):受显式模型绑定约束,可为每个子 key 勾选可用模型
- **双来源模型**:子 key 可绑定「全局模型」(管理员配) ∪ 「用户 BYO 模型」(用户自配 provider)

### 降级基建(零依赖可启动)
- **数据库**:PostgreSQL(+pgvector)↔ SQLite(+sqlite-vec)自动降级
- **缓存**:Redis ↔ 进程内内存 LRU 自动降级
- **队列**:pg-boss(PG 模式)/ no-op(SQLite 模式)
- **对象存储**:S3 / R2 / Minio ↔ 本地磁盘自动降级

### 管理
- 管理员后台:Provider / Model / Route / User / Template / 用量统计 / 运维
- 用户面板:主/子 key 管理、BYO provider/model、记忆、模板、用量

---

## 🛠 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 15 App Router + TypeScript + Turbopack |
| ORM | Drizzle ORM(PostgreSQL / SQLite 双 dialect) |
| 缓存 | cache-manager v6 + Keyv + Redis |
| 队列 | pg-boss(PostgreSQL) |
| 认证 | Better Auth + admin 插件 + Drizzle 适配器 |
| AI | Vercel AI SDK v5(`@ai-sdk/openai` / `anthropic` / `google`) |
| 向量 | pgvector(PG)/ sqlite-vec(SQLite) |
| 协议 | MCP SDK(`@modelcontextprotocol/sdk`) |
| 监控 | prom-client + `/metrics` 端点 |
| UI | TailwindCSS v4 + shadcn/ui + Radix |
| 加密 | AES-256-GCM(所有 provider key 加密入库) |

---

## 🚀 快速开始

### 零依赖本地开发(默认 SQLite + 内存缓存)

```bash
pnpm install
pnpm db:push:sqlite          # 建表(SQLite 模式,一次性)
pnpm dev                      # 启动 http://localhost:3000
```

> 首次启动会**自动**创建首个管理员账号(读 `.env.local` 的 `SEED_ADMIN_*`)。
> PG 模式下连建表也会自动跑(`drizzle migrate`),无需手动 migrate。
> `pnpm seed` 仅用于手动重置管理员。

首次登录:用 `.env.local` 里 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` 登录 `/login`。

### 配置上游 Provider

1. 登录后进入 `/admin/providers` 添加全局 Provider(base_url + key,加密存储)
2. 进入 `/admin/models` 创建对外模型名,绑定到 Provider 的上游模型
3. 进入 `/panel/keys` 生成主密钥,或创建子密钥并绑定模型

### 调用网关(OpenAI 兼容)

```bash
# 列出可用模型
curl https://your-host/v1/models \
  -H "Authorization: Bearer sk-your-master-key"

# 对话(流式)
curl https://your-host/v1/chat/completions \
  -H "Authorization: Bearer sk-your-master-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

Python / Node OpenAI SDK 零改动接入:

```python
from openai import OpenAI
client = OpenAI(base_url="https://your-host/v1", api_key="sk-your-master-key")
resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "你好"}],
)
```

### 使用 PostgreSQL + Redis(生产推荐)

```bash
docker compose up -d           # 启动 pg + redis
# 取消 .env.local 中 DATABASE_URL / REDIS_URL 注释,设 DB_DIALECT=pg
pnpm dev                       # 主进程(首次启动自动建表 + 建管理员)
pnpm worker                    # 另开终端:文件处理队列(PG 模式)
```

---

## ⚙️ 环境变量

见 [`.env.example`](./.env.example)。关键项:

| 变量 | 说明 | 默认 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串;留空走 SQLite | - |
| `DB_DIALECT` | `pg` / `sqlite`;留空按 DATABASE_URL 自动判断 | 自动 |
| `SQLITE_PATH` | SQLite 文件路径(仅 sqlite 模式) | `./data/local.db` |
| `REDIS_URL` | Redis 连接串;留空走内存 | - |
| `DATA_ENCRYPTION_KEY` | AES-256-GCM 主密钥(64 位 hex) | 必填 |
| `BETTER_AUTH_SECRET` | 认证密钥 | 必填 |
| `BETTER_AUTH_URL` | 应用对外根 URL | `http://localhost:3000` |
| `SK_PREFIX` | 签发 API key 前缀 | `sk-` |
| `STORAGE_DRIVER` | `local` / `s3` / `r2` / `minio` | `local` |
| `METRICS_ENABLED` | `/metrics` 端点开关 | `true` |

---

## 🐳 Docker 部署

```bash
docker build -t nekusora .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@db:5432/nekusora \
  -e DATA_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  nekusora
```

SQLite 模式挂载 `/app/data` 卷即可持久化。

---

## 📁 项目结构

```
src/
  app/
    (auth)/login/          登录
    chat/                  WebChat(会话列表 + 对话区 + 流式)
    share/[shareId]/       只读会话分享
    admin/                 管理后台(providers/models/users/usage/templates/operations)
    panel/                 用户面板(keys/providers/models/memory/templates)
    api/
      chat/route.ts        WebChat 流式端点(session 鉴权)
      auth/[...all]/       Better Auth
      files/ upload/       文件上传
    v1/                    OpenAI 兼容网关(sk 鉴权)
      chat/completions/    对话
      images/generations/  图像
      audio/speech/        TTS
      audio/transcriptions/ STT
      mcp/                 MCP 桥接
      models/
    metrics/               Prometheus
    healthz/               健康检查
  lib/
    providers/             统一 IR + provider 适配(openai/anthropic/gemini)
    routing.ts             四表路由器 + 加权负载均衡 + 故障转移
    stream.ts              唯一流式核心 streamChat()
    keys.ts                主/子密钥签发与校验
    tokens.ts              CJK token 估算 + 上下文裁剪
    multimodal/            多模态输入处理
    rag/                   检索增强(pgvector / sqlite-vec)
    memory/                长期记忆
    mcp/                   MCP 适配
    templates/             Prompt 模板
    artifacts/             Artifacts 渲染
    infra/                 db/cache/queue/crypto/vector/storage 降级基建
  db/
    schema/{pg,sqlite}.ts  Drizzle 双 dialect schema
```

---

## 🔒 安全

- 所有 provider `api_key` 用 **AES-256-GCM** 加密入库(`DATA_ENCRYPTION_KEY`)
- 对外 `sk-*` 只存 sha256 hash,明文仅创建时一次性展示
- 启动时校验关键密钥非弱 / 非默认
- `internal` 范围模型不对外暴露(仅系统任务用)

---

## 🎨 设计

Nekusora 遵循自研设计系统「**星枢天流 (The Astral Skyline)**」:暮色微澜黑与星云纯白的双面平衡 —— 聊天侧温和治愈、管理侧莫兰迪灰调严谨专业。完整设计参数见 [DESIGN.md](./DESIGN.md),产品定位见 [PRODUCT.md](./PRODUCT.md)。

---

## 📄 License

[MIT](./LICENSE) © Nekusora Contributors
