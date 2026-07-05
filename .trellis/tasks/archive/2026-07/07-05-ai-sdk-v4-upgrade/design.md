# Design: ai-sdk 升级到 V4

## 架构与边界

升级范围限定在 LLM 调用链 7 个文件 + 依赖版本。不涉及业务逻辑、DB schema、前端 UI 组件。

升级手段分两类:
1. **codemod 自动**:`npx @ai-sdk/codemod upgrade src/`(v5→v7 全量)或分 `v6` / `v7` 两次跑。覆盖机械重命名。
2. **手动**:语义变化(codemod 不覆盖或需人工确认的)。

## 命中点清单(research 结论,按文件)

### stream.ts(核心,命中最多)
- `streamText({ system })` / `generateText({ system })` → `instructions`(codemod `rename-system-to-instructions`)。项目 `separateSystem` 已把 system 抽到顶层,messages 里无 system——迁到 `instructions` 行为不变,且 V7「system in messages 默认拒绝」不命中。
- `result.fullStream` → `result.stream`(codemod `rename-full-stream-to-stream`)
- `result.totalUsage` → `result.usage`(V4 的 `usage` 已是全步累计,语义等价旧 `totalUsage`)
- `result.finishReason`:V4 单步仍可顶层访问;项目用它判断 finish,**需确认 V4 行为**(见风险)
- `IRUsage` 映射:`reasoningTokens` → `outputTokenDetails.reasoningTokens`;`cachedInputTokens` → `inputTokenDetails.cacheReadTokens`(codemod `replace-reasoning-tokens` / `replace-cached-input-tokens`)

### registry.ts
- `createGoogleGenerativeAI` → `createGoogle`(codemod `rename-google-generative-ai-to-google`)
- `LanguageModel` 类型 V2→V4(随 `@ai-sdk/provider` 升级自动变,无需改代码)
- `createOpenAI` / `createAnthropic` / `createOpenAICompatible` 名字不变
- custom 分支走 `openai-compatible@3.x`(V4),system 保持 `role:"system"`,**developer role bug 解决**

### multimodal(image-gen / audio-stt / audio-tts)
- `experimental_generateImage` → `generateImage`(codemod `remove-experimental-generate-image`)
- `experimental_transcribe` → `transcribe`(codemod `rename-experimental-transcribe`)
- `experimental_generateSpeech` → `generateSpeech`(codemod `rename-experimental-generate-speech`)

### embedding.ts
- `embedMany` 名字不变 ✅
- model 构造若用 `textEmbeddingModel` → `embeddingModel`(5→6 codemod `rename-text-embedding-to-embedding`;research 显示该文件 model 变量来源待 implement 时确认)

### probe.ts
- `generateText` 名字不变;若传 `system` → `instructions`

## 环境约束

- **Node 22+**:运行时 `v24.15.0` ✅,补 `package.json` 的 `engines.node: ">=22"`(否则部署到低版本环境会炸)
- **ESM only**:Next.js 项目已 ESM ✅

## MCP 注意

- MCP HTTP transport `redirect` 默认 `follow`→`error`(SSRF 防护)。若项目 MCP server 用 HTTP 且依赖重定向,需显式 `redirect: 'follow'`。research 未发现 `createMCPClient` 配置,implement 时确认 `src/lib/mcp/registry.ts`。

## 兼容性与回滚

- 在 `upgrade/v4` 分支做,出问题直接丢分支,`main` 不受影响。
- 降级方案(`openai-compatible@1.x` + registry custom 分支)已验证可用,作为应急 fallback。
- codemod 大量改动是「机械重命名 + deprecated alias 仍可用」,即使漏改一处,V7 大多仍能跑(带 deprecation 警告),不会硬失败——这降低了升级风险。

## 关键风险

| 风险 | 处理 |
|---|---|
| `finishReason` V4 多步语义 | 项目 stream.ts 用 finish 事件判 `finished`,V4 单步仍顶层可访问;streamChatWithTools 多步用 `ev.finishReason` 是项目自己的 StreamEvent,不受 SDK 改动影响。implement 时核对 |
| `stream.test.ts` 用 mock V2 | codemod `rename-mock-v2-to-v3` 处理;若测试仍红,手动改 |
| embedding model 方法名 | implement 时确认 embedding.ts 的 model 来源,codemod + 手动兜底 |
| MCP redirect | 确认 mcp/registry.ts transport 配置 |
