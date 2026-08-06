# Directory Structure

> Backend organization for the Next.js control plane, Fastify data plane, and framework-neutral workspace packages.

---

## Core Layout

```
apps/
  web/
    src/app/                Next.js pages, control-plane routes/actions, and thin rollback handlers
    src/worker.ts           Transitional Worker entry; moves in the worker-boundary task
  gateway/
    src/main.ts             Environment/bootstrap/listen/shutdown entry
    src/server.ts           Fastify adapter, health checks, limits, cancellation, resource close
    src/handlers.ts         Route-name to framework-neutral Core handler map
packages/
  contracts/src/routes.ts   Data-plane route matrix shared by Gateway and Web rewrites
  core/src/http/            Framework-neutral Request -> Response handlers
  core/src/lib/             Routing, providers, chat, RAG, memory, and Worker domain logic
  db/src/                   Drizzle schema and process-local PostgreSQL access
  observability/src/        Metrics, usage, and safe logging
  queue/src/                Typed catalog and pg-boss adapter
```

## Module Organization

- **Dependency direction**: application adapters may import workspace packages; workspace packages must not import `apps/*`. Shared packages must not accept `NextRequest`/`FastifyRequest` or return `NextResponse`/`FastifyReply`.
- **HTTP ownership**: `packages/contracts/src/routes.ts` is the route matrix. `apps/gateway` adapts those routes to Core handlers; Web route files are thin exports retained only for transition rollback.
- **Queue catalog**: `packages/queue/src/catalog.ts` is the only source for queue names, payloads, finite policies, and safe retry messages. It must not import the pg-boss driver, Worker runtime, or domain handlers.
- **Worker ownership**: `packages/core/src/lib/worker/definitions.ts` owns domain registration; `runtime.ts` owns ordering, recovery timers, rollback, signal shutdown, and drain. `apps/web/src/worker.ts` remains a thin transitional entry until `apps/worker` is created.
- **Server Actions**: each Web page group keeps `actions.ts` or `{feature}-actions.ts`, marks it with `"use server"`, and calls shared domain code.
- **Node-only dependencies**: isolate DB/queue/storage drivers behind explicit package exports. Each application bundler decides whether a workspace package is bundled and which third-party modules remain runtime externals.
- **Streaming**: WebChat and API gateway calls share `packages/core/src/lib/stream.ts`; adapters must not call the AI SDK directly.
- **Provider protocols**: add protocol cases in `packages/core/src/lib/providers/registry.ts` so Web and Gateway share behavior.

## Provider 协议矩阵

`packages/core/src/lib/providers/registry.ts` 的 `buildLanguageModelWithKey` 按协议四分支构造 AI SDK `LanguageModel`。关键差异在 system 消息处理:

| 协议 | 构造 | system 消息 | 适用上游 |
|------|------|-----------|---------|
| `openai` | `createOpenAI().chat()` | reasoning/非 gpt 前缀模型转 developer role | OpenAI 官方 |
| `openai-compatible` | `createOpenAICompatible().chatModel()` | 保持 `role:"system"` | 第三方兼容(SiliconFlow/DeepSeek/Qwen/vLLM) |
| `anthropic` | `createAnthropic().chat()` | 原生 system | Anthropic |
| `gemini` | `createGoogle()(model)` | 原生 system | Google |

> **Gotcha(openai-compatible 协议)**:`openai-compatible` 必须用 `@ai-sdk/openai-compatible`,**不能**用 `@ai-sdk/openai`。后者对非 gpt 前缀模型会把 system 消息转成 `developer` role,SiliconFlow/DeepSeek 等第三方上游不认该 role,直接 400 拒收(`Input tag 'developer' found using 'role'...`)。
>
> **Gotcha(三方上游探测)**:`probeProviderKey` 未传模型名时不能硬编码占位模型(如 `gpt-4o-mini`),第三方上游(SiliconFlow 等)模型列表里没有它,会 `model_not_found` 误判探测失败。应先 `fetchUpstreamModels` 拉真实模型取首个探测,`/models` 不可达时再降级占位。

**AI SDK 版本基线**:`ai`@7 + `@ai-sdk/{openai,anthropic,google}`@4 + `@ai-sdk/openai-compatible`@3(LanguageModelV4 spec),Node ≥22。

## Naming Conventions

- 页面/组件:PascalCase(`ChatComposer.tsx`);lib 模块:kebab-case 或 camelCase。
- server action 文件统一命名 `actions.ts`(或 `{feature}-actions.ts`)。
