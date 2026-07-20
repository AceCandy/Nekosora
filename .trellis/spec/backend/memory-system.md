# Memory System 契约

> chat 记忆系统（长期记忆 + 短期压缩）的核心契约。改记忆抽取/召回/注入/压缩时按此。
>
> M-3 起记忆层切 mem0（全权抽取 + 存储 + 检索）；M-4 待重建 project 过期 + 诊断。

---

## Scenario: 三分类与生命周期

`UserMemory.scope`（存 mem0 metadata）：
- `preference`（偏好）：用户明确偏好，恒定注入，不过期。手动添加（/panel/memory）。
- `profile`（身份）：用户客观事实，恒定注入，不过期。手动添加。
- `project`（在做的事）：召回注入，M-4 用 mem0 `expirationDate` 1 周过期。AI 抽取（默认）+ 手动添加。

| 类 | 注入 | 来源 | 过期 |
|---|---|---|---|
| preference / profile | 恒定（限量） | 手动 add（`infer=false`） | 不过期 |
| project | 召回（topK） | AI 抽取（`infer=true`, scope=project）+ 手动 | M-4：1 周 `expirationDate` |

注：mem0 全权抽取不产 scope（LLM 只产 memory 文本）；AI 抽取的记忆统一标 `scope=project`（metadata）。preference/profile 由用户手动添加（可选 scope）。自研 extract.ts 的三分类 LLM 抽取（prompt/disclosure/confidence）已废弃。

---

## Scenario: 抽取（`src/lib/memory/extract.ts`）

- 流后异步，10 分钟全局频率保护（`memextract:${userId}` cache）。
- 把最近 6 轮对话作为 messages 传 `mem0.add(messages, {userId, metadata:{scope:"project", source:"ai"}})`（`infer=true`，mem0 LLM 全权抽取 + 去重 + 合并）。
- 失败静默（不阻断主对话）。
- 抽取后 `invalidateMemoryCache(userId)` 失效 getMemories 的 60s 缓存。

---

## Scenario: 召回与注入（`recall.ts` + `context-assembler.ts` + `orchestrator.ts`）

- preference / profile：恒定注入（getMemories 过滤 + buildPreferencePrompt/buildProfilePrompt）。
- project：`recallMemories(userId, query)` = `mem0.search(query, {topK, filters:{user_id, scope:"project"}})`，结果经 `toUserMemory` 转 UserMemory。
- mem0 不可用时 recallMemories 静默返回空（不阻断对话）。
- `assembleContext`：preference + profile 恒定 slot；project 召回 slot。

---

## Scenario: compact 质量增强（`src/lib/compact/service.ts`）

- 链式摘要：`buildSummary` 传 previous_summary（从 `context_snapshots` 取最近同分支 `summaryText`），LLM 合并更新，非从头重摘。**直接读 DB summaryText** 防注入格式漂移（kivio 教训：从注入的 system 消息抽取旧摘要会因格式不一致导致链式退化）。
- 质量兜底：摘要 < `MIN_SUMMARY_CHARS`(200) 拒绝覆盖旧 summary（防「收到✅」式短摘要污染）。
- 模型可配：`systemSettings.task.compact_model`，fallback 第一个 `visibility=public && enabled`。

---

## Scenario: 缓存（`src/lib/memory/service.ts`）

- `getMemories` 60s 缓存（`memories:${userId}`）。
- `invalidateMemoryCache(userId)` 在 `addMemory` / `updateMemory` / `deleteMemory` / `clearMemories` / `extractMemories` 后调用（`cacheDel`）。

---

## Gotcha

- **mem0 工厂（M-2）**：`src/lib/memory/mem0.ts` 的 `getMemory()` 惰性初始化（动态 import `mem0ai/oss` 避 Edge 打包，仿 `getDb`）。配置：vectorStore=pgvector（复用 `DATABASE_URL`，collectionName=`mem0_memories`，1024 维）、embedder=openai（bge-m3 经 `rag.embedding_*` 上游）、llm=openai（复用 embedding 上游连接 + `rag.mem0_llm_model`，回退 `task.title_model`）。admin「mem0 抽取模型」在 /admin/settings 模型配置区，保存后 `resetMemoryClient()`。
- **AI 抽取默认 project**：mem0 全权抽取不产 scope；AI 抽取统一标 `scope=project`（metadata）。preference/profile 靠用户手动添加。自研三分类 LLM 抽取（prompt/disclosure/confidence/去重）已废弃。
- **手动 add infer=false**：`addMemory` 传 `infer=false`，直接存原文，不经 mem0 LLM 抽取改写。
- **M-4 待重建**：`purgeExpiredProjectMemories`（project 1 周过期）+ `getMemoryDiagnostics`（重复/陈旧诊断）当前是 stub（M-3 切 mem0 后旧 user_memories 逻辑失效）。M-4 用 mem0 `expirationDate` + `mem0.getAll` 重建。`getMemories` 入口暂不触发过期清理。
- **mem0 自建表**：mem0 在本库 PG 自建 `mem0_memories` 表（与 `user_memories` 分离）。M-5 drop `user_memories`。
- **embedding 维度固定 1024(bge-m3)**：`file_chunks.embedding` 与 `user_memories.embedding` 均为 `vector(1024)`，常量 `EMBEDDING_DIM=1024`（`rag/embedding.ts`、`infra/vector.ts`）。管理员须配 1024 维 embedding 模型（如 bge-m3，经硅基流动等 OpenAI 兼容接口）。改维度须同步 schema 两处 + 两处常量 + 迁移清旧向量（维度不兼容，`ALTER TYPE` 前须 `UPDATE SET embedding=NULL`）。
- **输出呈现偏好（退化风险）**：自研 extract.ts 的 prompt 曾排除「回答呈现类偏好」；M-3 切 mem0 内置 prompt 后不再硬过滤。若需恢复，用 mem0 `customInstructions` 定制（M-4/M-5 可加）。

---

## 相关

- `src/lib/memory/{mem0,service,recall,extract}.ts`
- `src/lib/compact/service.ts`
- `src/lib/context-assembler.ts`
- `src/lib/chat/orchestrator.ts`
- `src/app/(dash)/panel/memory/page.tsx`
- `src/lib/infra/cache.ts`（`cacheWrap` / `cacheDel`）
- `src/lib/rag/embedding.ts`（`embedText` / `getEmbeddingConfig`）
- 调研存档：`docs/memory-system-audit.md`；任务：`07-11-chat-memory-enhancement`
