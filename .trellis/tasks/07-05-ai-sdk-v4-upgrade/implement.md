# Implement: ai-sdk 升级到 V4

## 前置(git 基础,brainstorm 已定)

1. `codeblock-inline-render` 任务改动单独提交或 `git stash`(不混入本次)
2. 降级改动(`registry.ts` custom 分支 + `package.json`/`pnpm-lock.yaml` 的 openai-compatible)保留——其代码被 V4 吸收
3. 开 `upgrade/v4` 分支

## 执行 checklist(有序)

- [ ] **升依赖**:`pnpm add ai@latest @ai-sdk/openai@latest @ai-sdk/anthropic@latest @ai-sdk/google@latest @ai-sdk/openai-compatible@latest`
- [ ] **跑 codemod**:`npx @ai-sdk/codemod upgrade src/`(v5→v7 全量;若想分阶段先 `npx @ai-sdk/codemod v6 src/` 再 `v7 src/`)
- [ ] **补 Node 约束**:`package.json` 加 `"engines": { "node": ">=22" }`
- [ ] **逐文件核对 codemod 改动 + 手动修**:
  - `stream.ts`:`fullStream`→`stream`、`totalUsage`→`usage`、`system`→`instructions`(两处)、`IRUsage` 字段(`reasoningTokens`→`outputTokenDetails.reasoningTokens`、`cachedInputTokens`→`inputTokenDetails.cacheReadTokens`)、确认 `finishReason` 行为
  - `registry.ts`:确认 `createGoogleGenerativeAI`→`createGoogle`;custom 分支(createOpenAICompatible)保留
  - `multimodal/*`:确认 `experimental_*`→稳定名
  - `embedding.ts`:确认 model 构造方法名(`textEmbeddingModel`→`embeddingModel` 若用到)
  - `probe.ts`:确认 `system`→`instructions`(若用)
- [ ] **MCP transport**:确认 `src/lib/mcp/registry.ts` 是否用 HTTP transport + 重定向,按需加 `redirect: 'follow'`
- [ ] **mock**:`stream.test.ts` 若用 `MockLanguageModelV2` 等 → V3(codemod 处理,手动兜底)
- [ ] **typecheck**:`pnpm typecheck`(允许保留与本次无关的 Markdown.tsx 预先存在错误)
- [ ] **lint**:`pnpm lint`
- [ ] **test**:`pnpm test`(重点 stream.test.ts)

## 验证命令

```bash
pnpm typecheck   # 类型通过(允许无关错误)
pnpm lint
pnpm test        # stream.test.ts 等
```

P0 手动回归(需运行环境 + key):
- chat:新会话流式 / 续写 / 重试 / reasoning 透传 / 用量统计
- embedding+RAG:知识库检索召回
- 多模态:图像生成 / 语音 STT / 语音 TTS
- custom 协议(SiliconFlow):发消息不再 400 developer role

## 回滚点

- 任一步骤失控:`git checkout .` 丢弃,或直接丢 `upgrade/v4` 分支
- 升完发现某 provider(V4)有硬坑:该 provider 临时回退到 V2 不可行(混 spec 不兼容)——此时整体回退分支,改走降级方案(已验证)过渡,再单独排坑
