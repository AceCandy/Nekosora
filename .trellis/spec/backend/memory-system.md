# Memory System 契约

> chat 记忆系统（长期记忆 + 短期压缩）的核心契约。改记忆抽取/召回/注入/压缩时按此。
>
> M-3 起记忆层切 mem0（全权抽取 + 存储 + 检索）；M-4 重建 project 过期；诊断/disclosure 废弃（mem0 限制）；M-5 drop user_memories。

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
- 失败不阻断主对话；领域边界只记录 `client_init` / `memory_add` 有限阶段，禁止记录原始异常、消息、ID 或基础设施信息。
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
- 模型可配：优先 `systemSettings.task.compact_model_id`，兼容旧 `task.compact_model`，fallback 第一个 public + enabled + 可路由模型。

---

## Scenario: 缓存（`src/lib/memory/service.ts`）

- `getMemories` 60s 缓存（`memories:${userId}`）。
- `invalidateMemoryCache(userId)` 在 `addMemory` / `updateMemory` / `deleteMemory` / `clearMemories` / `extractMemories` 后调用（`cacheDel`）。

---

## Gotcha

- **mem0 工厂（M-2）**：`src/lib/memory/mem0.ts` 的 `getMemory()` 惰性初始化（动态 import `mem0ai/oss` 避 Edge 打包，仿 `getDb`）。配置：vectorStore=pgvector（复用 `DATABASE_URL`，collectionName=`mem0_memories`，1024 维）、embedder=openai（bge-m3 经 `rag.embedding_*` 上游）、llm=langchain（`createNekosoraLLM` 复用统一模型执行核心）。Embedding Provider 只负责向量化，不提供 Mem0 LLM 连接。
- **AI 抽取默认 project**：mem0 全权抽取不产 scope；AI 抽取统一标 `scope=project`（metadata）。preference/profile 靠用户手动添加。自研三分类 LLM 抽取（prompt/disclosure/confidence/去重）已废弃。
- **手动 add infer=false**：`addMemory` 传 `infer=false`，直接存原文，不经 mem0 LLM 抽取改写。
- **M-4：project 过期已重建,诊断/disclosure 废弃**：project 记忆 add 时设 `expirationDate=+7d`（`AddMemoryOptions` 软过滤 + `metadata.expirationDate` 供硬删）；`purgeExpiredProjectMemories` 在 `getMemories` 入口懒硬删（`getAll({showExpired:true})` + filter + delete）。诊断废弃：mem0 `MemoryItem` 不暴露 embedding/lastAccessedAt,重复/陈旧检测不可行（`getMemoryDiagnostics` 已删）。disclosure 废弃：mem0 全权抽取不产 disclosure。M-5 已移除诊断/disclosure UI。
- **mem0 自建表**：mem0 在本库 PG 自建 `mem0_memories` 表承载记忆。`user_memories` 表已于 M-5 drop（迁移 0006）。
- **embedding 维度固定 1024(bge-m3)**：`file_chunks.embedding` 与 `user_memories.embedding` 均为 `vector(1024)`，常量 `EMBEDDING_DIM=1024`（`rag/embedding.ts`、`infra/vector.ts`）。管理员须配 1024 维 embedding 模型（如 bge-m3，经硅基流动等 OpenAI 兼容接口）。改维度须同步 schema 两处 + 两处常量 + 迁移清旧向量（维度不兼容，`ALTER TYPE` 前须 `UPDATE SET embedding=NULL`）。
- **输出呈现偏好（退化风险）**：自研 extract.ts 的 prompt 曾排除「回答呈现类偏好」；M-3 切 mem0 内置 prompt 后不再硬过滤。若需恢复，用 mem0 `customInstructions` 定制（M-4/M-5 可加）。

---

## 约束：mem0 接入与升级兼容

记忆层全面委托 `mem0ai/oss`（OSS 自托管，非 Platform 云版）。为可跟随官方升级，接入须守以下约束：

- **只用 SDK 公开稳定接口**：仅 `Memory` class + 标准 `MemoryConfig`（vectorStore/embedder/llm 三段式）+ 标准 Options（`AddMemoryOptions`/`SearchMemoryOptions`/`GetAllMemoryOptions`）。禁止 monkey-patch、改 SDK 内部、或绕开 SDK 直接读写 `mem0_memories` 表。
- **禁用未使用的 mem0 history**：构造 `Memory` 时设置 `disableHistory:true`；聊天历史由业务表持久化，项目不调用 `memory.history()`，不得为此引入 `better-sqlite3` 本地历史库。
- **表结构交 mem0 自管**：`mem0_memories` 由 mem0 首次 `getMemory()` 自建并维护，业务不定义其 schema、不写迁移。`user_memories` 自建表已于 M-5 drop。
- **已用方法**：add/search/update/delete/getAll/deleteAll；`Memory` 另有 get/history/reset，业务暂未用（非缺失）。
- **自定义 metadata 字段**（存 metadata JSON，非 SDK 原生）：`scope`/`source`/`expirationDate`/`priority`；`disclosure` 已废弃（M-4）。search filter 按 `user_id`（原生）+ `scope`（自定义塞 metadata 再 filter）。
- **升级流程**：① 看 changelog（关注 MemoryConfig/Options 字段名、过期语义、表结构）；② 测试环境验证 add/search/过期；③ 备「清 `mem0_memories` 重建」退路（记忆可由对话重抽，丢失成本低）；④ major 版（如 4.0）手动改 `package.json` + 重点验证配置字段；⑤ caret（`^3.1.0`）内 minor/patch 自动跟进，lockfile 更新仍跑记忆测试。
- **OSS vs Platform**：用 OSS 开源核心（向量+LLM 抽取+去重合并+过期）；Platform 独有的 hosted dashboard / graph memory 不在范围，新特性可能先上 Platform、OSS 跟进滞后。
- **构建配置（`next.config.ts`）**：mem0ai 是大 bundle，内部动态 import 各 provider SDK（aws/azure/google/qdrant…，均为 peerDep，按需加载）。必须设 `serverExternalPackages: ["mem0ai"]`，构建时不打包其依赖图、运行时按需 require。否则 webpack 解析缺失的 peer provider SDK（如 `@aws-sdk/client-bedrock-runtime`）报 Module not found。我们只用 pgvector（`pg`，已装）+ openai（mem0ai dep 自带），运行时不触发缺失包。

## Scenario: Mem0 LLM 复用统一模型执行核心

### 1. Scope / Trigger

- 修改 Mem0 抽取模型配置、Worker 配置刷新或统一生成核心时，必须保持本节契约。

### 2. Signatures

- 设置键：`rag.mem0_llm_model_id`；旧兼容键：`rag.mem0_llm_model`。
- `getMemory({ refreshModel?: boolean }): Promise<Memory>`。
- `createNekosoraLLM({ modelId, modelName })` 返回 Mem0 langchain provider 可调用的 `invoke()` 模型对象。

### 3. Contracts

- 模型按 `mem0_llm_model_id` → 旧模型名对应 public modelId → `task.title_model_id` → 旧标题模型名解析；每个候选都必须经 `resolveRoutesById` 确认存在启用路由和 Provider。
- Mem0 `embedder` 继续读取 `rag.embedding_*`，只负责向量化；`llm` 不得复用 Embedding Provider URL，也不得 HTTP 回环调用本机 `/v1`。
- `invoke()` 调 `generateChat({ modelId, taskKind:"memory" })`；`json_object` 映射为 `output:"json"`，由 AI SDK `Output.json()` 适配不同上游协议。
- Worker 抽取传 `refreshModel:true`，每次重新核对设置指纹；管理端进程内 `resetMemoryClient()` 不能替代 Worker 刷新。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| 配置 ID 可路由 | 使用该 ID |
| 旧模型名存在但无启用路由/Provider | 继续尝试标题模型回退 |
| 所有候选失效 | `getMemory` 抛错，Worker 异步重试，不阻断 Chat |
| `json_object` 请求 | 统一核心使用结构化 JSON 输出 |
| Worker 中模型设置变化 | 指纹不同则重建 Mem0 client |

### 5. Good / Base / Bad Cases

- Good：Mem0 选择 Anthropic/Gemini 等已配置 public 模型，统一核心完成协议翻译和结构化输出。
- Base：未配置专用模型时回退可路由的标题模型。
- Bad：只按模型名查 enabled/public，不校验路由，导致失效模型阻断后续回退。

### 6. Tests Required

- `nekosora-llm.test.ts`：断言消息转换、`modelId`、`taskKind:"memory"` 与 `json_object → output:"json"`。
- `mem0.test.ts`：断言旧模型名无路由时继续回退到标题模型 ID。
- `stream-circuit-breaker.test.ts`：断言 `generateChat` 的 byId 路由和 JSON 输出参数。

### 7. Wrong vs Correct

```typescript
// Wrong：把 chat 模型绑定到 Embedding Provider，且绕过统一协议路由。
llm: { provider: "openai", config: { baseURL: embedding.baseUrl, model: modelName } }

// Correct：Embedding 与 LLM 分离，Mem0 通过公开 langchain 入口复用统一执行核心。
llm: { provider: "langchain", config: { model: createNekosoraLLM({ modelId, modelName }) } }
```

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
