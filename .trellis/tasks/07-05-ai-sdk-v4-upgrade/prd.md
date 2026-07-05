# ai-sdk 升级到 V4

## Goal

把项目 ai-sdk 全家桶从 V2 spec 升级到 V4 spec,跟齐上游最新版本;顺带根治 custom 协议下 `@ai-sdk/openai` 对非 gpt 前缀模型把 system 消息转成 developer role、被 SiliconFlow 等第三方上游以 400 拒收的 bug。

升级后,custom 协议走 `@ai-sdk/openai-compatible@3.x`,system 保持原样,bug 自然消失。

## Background

- **直接动因**:custom 协议(第三方 OpenAI 兼容上游)走 `createOpenAI().chat()`,`@ai-sdk/openai` 对非 `gpt-3/4/chatgpt-4o/gpt-5-chat` 前缀的模型硬编码 `systemMessageMode = "developer"`,导致 system 消息被发成 `role:"developer"`,SiliconFlow 等只认 `system/user/assistant/tool` 的上游直接 400。该 bug 无 providerOptions 覆盖入口。
- **V2 现状(当前锁定)**:`ai@5.0.203`、`@ai-sdk/openai@2.0.107`、`@ai-sdk/anthropic@2.0.82`、`@ai-sdk/google@2.0.75`(均 `provider@2.x` = V2 spec)。
- **V4 全套齐整**:`ai@7.0.15`、`@ai-sdk/openai@4.0.7`、`@ai-sdk/anthropic@4.0.8`、`@ai-sdk/google@4.0.8`、`@ai-sdk/openai-compatible@3.0.5`(均 `provider@4.x` = V4 spec)。

## 受影响范围

ai-sdk API 使用集中在 7 个文件、约 144 处调用:

| 文件 | 关键 API | 风险 |
|---|---|---|
| `src/lib/stream.ts` | `streamText`/`generateText`、`fullStream`、`totalUsage`、`finishReason`、`maxOutputTokens` | 高(chat 核心) |
| `src/lib/providers/registry.ts` | `LanguageModel` 类型 + `create*` 构造 | 高(V2→V4) |
| `src/lib/providers/probe.ts` | `generateText` | 中 |
| `src/lib/providers/multimodal/image-gen.ts` | `experimental_generateImage` | 中(experimental_ 易改名) |
| `src/lib/providers/multimodal/audio-stt.ts` | `experimental_transcribe` | 中 |
| `src/lib/providers/multimodal/audio-tts.ts` | `experimental_generateSpeech` | 中 |
| `src/lib/rag/embedding.ts` | `embedMany` + `textEmbeddingModel` | 中(方法名可能改) |

调用入口:`src/app/api/chat/route.ts`(WebChat)、`src/app/v1/*`(对外网关:images/audio)。

## 已确认的 breaking changes(5→6→7 概览)

- **usage 字段**:`reasoningTokens` / `cachedInputTokens` 弃用并移除 → `outputTokenDetails.reasoningTokens` / `inputTokenDetails.cacheReadTokens`。`stream.ts` 的 `IRUsage` 映射直接命中。
- **experimental_* API**:image/audio 三个 `experimental_*` 大概率改名或稳定化(去掉前缀)。
- **embedding**:`textEmbeddingModel`/`textEmbedding` → `embeddingModel`/`embedding`。
- **消息类型**:`CoreMessage` 移除 → `ModelMessage`;`convertToModelMessages` 变 async。
- **mock 类**:`ai/test` 的 V2 mock → V3(项目 `stream.test.ts` 可能命中)。
- **官方工具**:`@ai-sdk/codemod` 提供批量重命名 codemod,可辅助大部分机械改动。
- **finish reason**:`unknown` 合并入 `other`。
- **provider 选项**:openai `structuredOutputs` 移除 → `strictJsonSchema`(默认 true)。

## Requirements

- R1: ai-sdk 全家桶升到 V4 spec(`ai@7` + `openai/anthropic/google@4` + `openai-compatible@3`),项目可编译(`pnpm typecheck` 通过)。
- R2: custom 协议 developer role bug 解决——custom 上游 system 消息保持 `role:"system"`,SiliconFlow 等不再 400。
- R3: P0 场景回归通过(见 Acceptance)。
- R4: MCP 工具调用链路(`streamChatWithTools`)降级为非 P0——仅保证编译通过、不被破坏,不做深度回归。

## Acceptance Criteria(P0 回归清单)

- [ ] `pnpm typecheck` 通过(允许保留与本次无关的预先存在错误)
- [ ] `pnpm test`(含 `stream.test.ts`)通过
- [ ] chat 流式对话:新会话 / 续写 / 重试正常,reasoning 增量透传,用量统计(input/output/cached/reasoning)数值合理
- [ ] embedding + RAG:知识库检索召回正常,`embedMany` 不报错
- [ ] 多模态:图像生成 / 语音 STT / 语音 TTS 三条端点功能正常(`experimental_*` 已迁到 V4 新名)
- [ ] custom 协议(SiliconFlow 等)发消息不再 400 developer role

## Out of Scope

- MCP 工具调用的深度回归(仅保证编译 + 不破坏)
- 主动采用 V4 新特性(`Output.object` 结构化、`ToolLoopAgent` 等)——本次只做迁移,不扩展功能

## Decisions(brainstorm 阶段)

- **验收 P0**:chat 流式+reasoning+续写 / embedding+RAG / 多模态(图像/语音)。MCP 工具调用降为非 P0(仅保证编译不破坏)。
- **git 基础**:清理后开新分支——codeblock 任务改动单独提交或 stash,降级改动(registry/package/lockfile)保留(其代码被 V4 吸收),main 干净后开 `upgrade/v4`。
- **升级手段**:用官方 `@ai-sdk/codemod` 批量改机械重命名 + 手动处理语义变化(usage 字段、`experimental_*` API、message 组装)。

## 规划产物

- 详细命中点与技术设计:`design.md`
- 有序执行步骤与验证:`implement.md`
- 所有 repo 可答的问题均已通过代码检查 + 官方迁移指南(5→6、6→7)research 确认,无遗留 blocking open question。
