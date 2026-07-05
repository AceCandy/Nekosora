# Directory Structure

> Backend(server-side)代码组织约定。Nekusora 是 Next.js 全栈 TypeScript 项目,无独立后端进程(除 worker)。

---

## 核心布局

```
src/
  app/                      Next.js App Router(路由 + API 端点)
    api/                    内部 API(/api/chat, /api/upload, /api/auth/*)
    v1/                     对外网关(OpenAI 兼容,/v1/chat/completions, /v1/models)
    admin/                  管理后台页面 + actions.ts(server actions)
    panel/                  用户面板页面 + actions.ts
    chat/                   WebChat 页面 + actions.ts + ChatComposer 组件
    share/                  公开分享页
  lib/
    infra/                  降级基建:db/cache/queue/crypto/vector/env
    providers/              统一 IR + provider 适配(openai/custom/anthropic/gemini)
    rag/                    RAG 流水线:embedding/chunk/extract/retrieve/context/process
    compact/                上下文压缩:coverage(CoveragePathHash)/service(4级回退)
    memory/                 长期记忆(user_memories)
    routing.ts              四表模型路由器(负载均衡/故障转移)
    stream.ts               唯一流式核心 streamChat()
    keys.ts                 主/子密钥签发与校验
    tokens.ts               CJK token 估算 + 上下文裁剪
    trace.ts                process_trace 构造
    context-assembler.ts    槽位式上下文组装
    usage.ts                用量记录
    session.ts              会话/鉴权辅助
    auth.ts / auth-client.ts  Better Auth 配置(server / client)
  db/
    schema/{pg,sqlite}.ts   Drizzle 双 dialect schema(24 表,必须同构)
    types.ts                dialect 中立领域类型
    seed.ts                 首管理员创建
  instrumentation.ts        进程启动钩子(日志)
  worker.ts                 pg-boss 消费进程(文件处理流水线,仅 PG 模式)
```

## Module Organization

- **分层**:`app/`(路由/页面/端点)→ `lib/`(业务逻辑)→ `lib/infra/`(基建)。lib 不 import app;infra 不 import 业务。
- **server actions**:每个页面组(如 `admin/`)下放 `actions.ts`,用 `"use server"` 标注,内部 import lib。
- **降级模块**(db/cache/queue)用动态 import 加载驱动,避免 bundler 把未用 dialect 打进 Edge 编译(见 `util/types` 教训)。
- **唯一流式入口**:所有 LLM 调用(WebChat + 网关)都经 `streamChat()`,禁止直接调 AI SDK 的 streamText。
- **新 provider 协议**:在 `lib/providers/registry.ts` 加 case,Chat 和网关同时受益。

## Provider 协议矩阵

`lib/providers/registry.ts` 的 `buildLanguageModelWithKey` 按协议四分支构造 AI SDK `LanguageModel`。关键差异在 system 消息处理:

| 协议 | 构造 | system 消息 | 适用上游 |
|------|------|-----------|---------|
| `openai` | `createOpenAI().chat()` | reasoning/非 gpt 前缀模型转 developer role | OpenAI 官方 |
| `custom` | `createOpenAICompatible().chatModel()` | 保持 `role:"system"` | 第三方兼容(SiliconFlow/DeepSeek/Qwen/vLLM) |
| `anthropic` | `createAnthropic().chat()` | 原生 system | Anthropic |
| `gemini` | `createGoogle()(model)` | 原生 system | Google |

> **Gotcha(custom 协议)**:`custom` 必须用 `@ai-sdk/openai-compatible`,**不能**用 `@ai-sdk/openai`。后者对非 gpt 前缀模型会把 system 消息转成 `developer` role,SiliconFlow/DeepSeek 等第三方上游不认该 role,直接 400 拒收(`Input tag 'developer' found using 'role'...`)。

**AI SDK 版本基线**:`ai`@7 + `@ai-sdk/{openai,anthropic,google}`@4 + `@ai-sdk/openai-compatible`@3(LanguageModelV4 spec),Node ≥22。

## Naming Conventions

- 页面/组件:PascalCase(`ChatComposer.tsx`);lib 模块:kebab-case 或 camelCase。
- server action 文件统一命名 `actions.ts`(或 `{feature}-actions.ts`)。
