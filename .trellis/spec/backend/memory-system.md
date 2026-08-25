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
- 自动 project 记忆的角色、内容门禁与有界快照遵循下方「Automatic Project Memory Boundary」契约。
- 合格消息传 `mem0.add(messages, {userId, metadata:{scope:"project", source:"ai"}})`（`infer=true`，mem0 LLM 全权执行 ADD-only 抽取，不更新、删除或合并旧记忆；写入阶段按提取文本的精确哈希去重。抽取 LLM 会参考语义召回的旧记忆避免重复事实，但这不是确定性语义去重）。
- 失败不阻断主对话；领域边界只记录 `client_init` / `memory_add` 有限阶段，禁止记录原始异常、消息、ID 或基础设施信息。
- 抽取后 `invalidateMemoryCache(userId)` 失效 getMemories 的 60s 缓存。

---

## Scenario: 召回与注入（`recall.ts` + `context-assembler.ts` + `orchestrator.ts`）

- preference / profile：恒定注入（getMemories 过滤 + buildPreferencePrompt/buildProfilePrompt）。
- project：按下方「Automatic Project Memory Boundary」过滤查询，再通过 `mem0.search` 召回并经 `toUserMemory` 转 UserMemory。
- mem0 不可用时 recallMemories 静默返回空（不阻断对话）。
- `assembleContext`：preference + profile 恒定 slot；project 召回 slot。

---

## Scenario: Automatic Project Memory Boundary

### 1. Scope / Trigger

修改自动 project 记忆的消息快照、durable job、Worker 抽取、Mem0 初始化或语义召回时适用。目标是阻止低信息输入和助手生成内容被晋升为用户长期意图。

### 2. Signatures

- `isMemoryEligibleText(text: string): boolean`：文本是否包含 Unicode `Letter` 类字符。
- `normalizeMemoryMessages(recentMessages): MemoryExtractionMessage[]`：从最近 6 条消息生成最多 500 字的 user-only 快照。
- `createMemoryExtractionJob(input): MemoryExtractionJob | null`。
- `extractMemories(userId, conversationId, recentMessages, model?): Promise<"completed" | "noop">`。
- `recallMemories(userId, query, topK=5): Promise<UserMemory[]>`。

### 3. Contracts

- 只接受原始 `role === "user"` 的消息；assistant/system/tool/未知角色不得转换成 user 或进入 `memory.add`。
- 门禁判定最近窗口中最后一条准确 user 消息。该消息不含 Unicode 字母时，任务创建返回 `null`，Worker 返回 `noop`，召回返回 `[]`；这些返回必须发生在 Mem0 初始化和 10 分钟频率保护之前。
- 单条合格 user 消息足以创建任务。每条 durable 内容最多 500 字；若首个 Unicode 字母出现在第 500 字之后，从该字母开始截取有界窗口，避免截断改变 eligibility。
- Mem0 `customInstructions` 仅保留用户明确表达的耐久事实、稳定偏好、持续项目和用户确认的决定，并排除标题、寒暄、澄清、临时请求、工具输出与助手推测。Prompt 是软约束，不能替代确定性角色/内容门禁。
- 合格召回固定传 `topK:5`、`threshold:0.5` 和 `filters:{user_id, scope:"project"}`。`0.5` 是当前保守初始值，不是 Mem0 通用推荐阈值。
- preference/profile 手动记忆、7 天 project 过期、失败降级、缓存失效与错误脱敏契约保持不变。

### 4. Validation & Error Matrix

| 输入 / 条件 | 抽取任务 / Worker | 召回 |
|---|---|---|
| `111`、纯符号、空白或 emoji | 不建任务 / `noop`，不初始化 Mem0 | `[]`，不初始化 Mem0 |
| `项目 111` | user-only 有界快照进入 `memory.add` | 按 `threshold:0.5` 搜索 |
| assistant 输出标题或建议，用户未确认 | assistant 被确定性排除 | 不作为 user 事实来源 |
| 先有有意义 user，最新 user 为 `111` | 以最新 user 为准，跳过 | 当前 query 为 `111` 时跳过 |
| 前 500 字无字母，第 501 字起为有意义文本 | 从首个字母开始取最多 500 字并继续抽取 | 原 query 直接判定为合格 |
| Mem0 初始化或操作失败 | 抽取抛通用可重试错误 | 静默返回 `[]` |

### 5. Good / Base / Bad Cases

- Good：`user:111 -> assistant:会话标题：111` 不创建 project 记忆，也不让助手标题反向成为用户意图。
- Good：用户明确说「项目使用 PostgreSQL」，即使是唯一一条 user 消息也可进入抽取。
- Base：有意义 query 使用原 topK/filter，并加显式 `threshold:0.5`。
- Bad：把非 assistant 的未知角色统一映射为 user；tool/system 内容会被错误归因。
- Bad：只靠 `customInstructions` 过滤；Mem0 的抽取 LLM 仍可能违反软提示。
- Bad：在频率保护之后才判断低信息输入；无价值输入会消耗用户的抽取窗口。

### 6. Tests Required

- `extract.test.ts`：断言 user-only payload、单 user 可抽取、最新数字 user 在 Mem0 初始化前 no-op、500 字之后的字母仍保留 eligibility。
- `jobs.test.ts`：断言 durable snapshot 排除 assistant/system/tool/未知角色，且「早先有意义 + 最新 111」不建任务。
- `recall.test.ts`：断言数字、空白、符号、emoji 不初始化/搜索 Mem0；合格 query 精确传 `topK:5`、`threshold:0.5` 和 user/scope filters。
- `mem0.test.ts`：断言顶层 `customInstructions` 同时包含耐久用户事实门槛和禁止助手归因规则。

### 7. Wrong vs Correct

```typescript
// Wrong：助手消息和未知角色可能被 Mem0 归因为用户事实。
const turns = recentMessages.map((message) => ({
  role: message.role === "assistant" ? "assistant" : "user",
  content: String(message.content),
}));

// Correct：只保留准确 user 角色，并在任何 Mem0 副作用前执行共享门禁。
const turns = normalizeMemoryMessages(recentMessages);
const latestUserMessage = turns.at(-1);
if (!latestUserMessage || !isMemoryEligibleText(latestUserMessage.content)) {
  return "noop";
}
```

---

## Scenario: compact 质量增强（`src/lib/compact/service.ts`）

- 链式摘要：`buildSummary` 传 previous_summary（从 `context_snapshots` 取最近同分支 `summaryText`），LLM 合并更新，非从头重摘。**直接读 DB summaryText** 防注入格式漂移（kivio 教训：从注入的 system 消息抽取旧摘要会因格式不一致导致链式退化）。
- 质量兜底：摘要 < `MIN_SUMMARY_CHARS`(200) 拒绝覆盖旧 summary（防「收到✅」式短摘要污染）。
- 模型可配：优先 `systemSettings.task.compact_model_id`，兼容旧 `task.compact_model`，fallback 第一个 public + enabled + 可路由模型。

---

## Scenario: 缓存（`src/lib/memory/service.ts`）

### 1. Scope / Trigger

- 修改 `UserMemory`、`getMemories` 或 Keyv/cache-manager 缓存边界时适用。

### 2. Signatures

- `getMemories(userId): Promise<UserMemory[]>`，缓存键 `memories:${userId}`，TTL 60s。
- `toMemoryDate(value: unknown): Date | null`。
- `invalidateMemoryCache(userId)` 在 `addMemory` / `updateMemory` / `deleteMemory` / `clearMemories` / `extractMemories` 后调用。
- 缓存未命中只调用一次 `memory.getAll({ filters:{ user_id:userId }, showExpired:true })`。

### 3. Contracts

- Keyv 会把 `Date` 序列化为字符串；`getMemories` 必须在 `cacheWrap` 出口恢复 `createdAt`，保证首次读取与缓存命中都符合 `UserMemory.createdAt: Date | null`。
- 空值或无效日期统一收敛为 `null`，不得把无效 `Date` 传给排序或渲染层。
- Mem0 读取、过期 project 过滤与懒硬删必须位于 `cacheWrap` fetcher 内；缓存命中不得初始化或访问 Mem0。
- fetcher 用同一次 `showExpired:true` 结果返回有效记忆，并以 `Promise.allSettled` 尽力删除 `metadata.scope=project` 且 `metadata.expirationDate < today` 的记录；单条删除失败不得丢弃有效结果。

### 4. Validation & Error Matrix

| 输入 | 输出 |
|---|---|
| 有效 `Date` | 原 `Date` |
| ISO 日期字符串 | 等值 `Date` |
| 空值或无效字符串 | `null` |
| 60s 内缓存命中 | 返回缓存结果，Mem0 `getAll` / `delete` 均不调用 |
| 缓存未命中且包含过期 project | 过滤过期项，单次 `getAll`，尽力 `delete` |
| 过期项 `delete` 失败 | 仍返回其余有效记忆 |
| `getAll` 失败 | 返回空数组，不阻断页面或对话 |

### 5. Good / Base / Bad Cases

- Good：缓存命中返回字符串日期，service 出口恢复为 `Date`。
- Good：连续两次读取同一用户只发生一次 Mem0 `getAll`。
- Base：mem0 首次读取已返回 `Date`，保持原对象。
- Base：未命中结果没有过期 project，不调用 `delete`。
- Bad：页面直接对缓存值调用 `.getTime()`，导致 `getTime is not a function`。
- Bad：在 `cacheWrap` 之前调用过期清理；即使缓存命中，页面仍等待一次 Mem0 查询。

### 6. Tests Required

- 单测必须覆盖有效 `Date`、ISO 字符串、无效值，以及实际 Keyv 首次读取与缓存命中两次调用。
- 缓存测试必须断言连续读取只调用一次 `getAll(showExpired:true)`；过期测试必须断言过期 project 不返回，且 `delete` reject 时有效记忆仍返回。

### 7. Wrong vs Correct

```typescript
// Wrong：缓存命中前仍访问 Mem0 做清理。
await purgeExpiredProjectMemories(userId);
return cacheWrap(`memories:${userId}`, fetchMemories, 60_000);

// Correct：读取、过滤和尽力清理只发生在 cacheWrap fetcher 内。
const memories = await cacheWrap(`memories:${userId}`, async () => {
  const res = await memory.getAll({ filters: { user_id: userId }, showExpired: true });
  // 本地过滤过期 project，并用 Promise.allSettled 尽力删除。
  return activeMemories;
}, 60_000);
return memories.map((item) => ({ ...item, createdAt: toMemoryDate(item.createdAt) }));
```

---

## Gotcha

- **mem0 工厂（M-2）**：`src/lib/memory/mem0.ts` 的 `getMemory()` 惰性初始化（动态 import `mem0ai/oss` 避 Edge 打包，仿 `getDb`）。配置：vectorStore=pgvector（复用 `DATABASE_URL`，collectionName=`mem0_memories`，1024 维）、embedder=openai（bge-m3 经 `rag.embedding_*` 上游）、llm=langchain（`createNekosoraLLM` 复用统一模型执行核心）。Embedding Provider 只负责向量化，不提供 Mem0 LLM 连接。
- **Embedding 维度边界**：`mem0ai@3.1.6` 的 pgvector 用 `embeddingModelDims` 建立 `vector(1024)`；不要给 OpenAI-compatible embedder 设置 `embeddingDims`，因为 mem0 会把它翻译成请求字段 `dimensions`，部分固定维度上游会直接返回 400。
- **AI 抽取默认 project**：mem0 全权抽取不产 scope；AI 抽取统一标 `scope=project`（metadata）。preference/profile 靠用户手动添加。自研三分类 LLM 抽取（prompt/disclosure/confidence/去重）已废弃。
- **手动 add infer=false**：`addMemory` 传 `infer=false`，直接存原文，不经 mem0 LLM 抽取改写。
- **M-4：project 过期已重建,诊断/disclosure 废弃**：project 记忆 add 时设 `expirationDate=+7d`（`AddMemoryOptions` 软过滤 + `metadata.expirationDate` 供硬删）；`getMemories` 仅在缓存未命中时用一次 `getAll({showExpired:true})` 同时读取、过滤并尽力硬删，缓存命中不得访问 Mem0。诊断废弃：mem0 `MemoryItem` 不暴露 embedding/lastAccessedAt,重复/陈旧检测不可行（`getMemoryDiagnostics` 已删）。disclosure 废弃：mem0 全权抽取不产 disclosure。M-5 已移除诊断/disclosure UI。
- **mem0 自建表**：mem0 在本库 PG 自建 `mem0_memories` 表承载记忆。`user_memories` 表已于 M-5 drop（迁移 0006）。
- **embedding 维度固定 1024(bge-m3)**：`file_chunks.embedding` 与 `user_memories.embedding` 均为 `vector(1024)`，常量 `EMBEDDING_DIM=1024`（`rag/embedding.ts`、`infra/vector.ts`）。管理员须配 1024 维 embedding 模型（如 bge-m3，经硅基流动等 OpenAI 兼容接口）。改维度须同步 schema 两处 + 两处常量 + 迁移清旧向量（维度不兼容，`ALTER TYPE` 前须 `UPDATE SET embedding=NULL`）。
- **输出呈现偏好（退化风险）**：自研 extract.ts 的 prompt 曾排除「回答呈现类偏好」；M-3 切 mem0 内置 prompt 后不再硬过滤。若需恢复，用 mem0 `customInstructions` 定制（M-4/M-5 可加）。

---

## 约束：mem0 接入与升级兼容

记忆层全面委托 `mem0ai/oss`（OSS 自托管，非 Platform 云版）。为可跟随官方升级，接入须守以下约束：

- **只用 SDK 公开稳定接口**：仅 `Memory` class + 标准 `MemoryConfig`（vectorStore/embedder/llm 三段式）+ 标准 Options（`AddMemoryOptions`/`SearchMemoryOptions`/`GetAllMemoryOptions`）。禁止 monkey-patch、改 SDK 内部、或绕开 SDK 直接读写 `mem0_memories` 表。
- **禁用未使用的 mem0 history**：构造 `Memory` 时设置 `disableHistory:true`；聊天历史由业务表持久化，项目不调用 `memory.history()`。Mem0 3.1.6 发布入口仍顶层静态导入 `better-sqlite3`，所以生产依赖暂时保留它以保证模块可加载，但业务不创建或使用 SQLite history；官方改为延迟加载后再删除该兼容依赖。
- **表结构交 mem0 自管**：`mem0_memories` 由 mem0 首次 `getMemory()` 自建并维护，业务不定义其 schema、不写迁移。`user_memories` 自建表已于 M-5 drop。
- **已用方法**：add/search/update/delete/getAll/deleteAll；`Memory` 另有 get/history/reset，业务暂未用（非缺失）。
- **自定义 metadata 字段**（存 metadata JSON，非 SDK 原生）：`scope`/`source`/`expirationDate`/`priority`；`disclosure` 已废弃（M-4）。search filter 按 `user_id`（原生）+ `scope`（自定义塞 metadata 再 filter）。
- **升级流程**：① 看 changelog（关注 MemoryConfig/Options 字段名、过期语义、表结构）；② 测试环境验证 add/search/过期；③ 备「清 `mem0_memories` 重建」退路（记忆可由对话重抽，丢失成本低）；④ major 版（如 4.0）手动改 `package.json` + 重点验证配置字段；⑤ caret（`^3.1.6`）内 minor/patch 自动跟进，lockfile 更新仍跑记忆测试。
- **OSS vs Platform**：用 OSS 开源核心（向量+ADD-only LLM 抽取+写入阶段精确文本哈希去重+过期）；Platform 独有的 hosted dashboard / graph memory 不在范围，新特性可能先上 Platform、OSS 跟进滞后。
- **构建配置（`next.config.ts`）**：mem0ai 是大 bundle，内部动态 import 各 provider SDK（aws/azure/google/qdrant…，均为 peerDep，按需加载）。必须设 `serverExternalPackages: ["mem0ai"]`，构建时不打包其依赖图、运行时按需 require。否则 webpack 解析缺失的 peer provider SDK（如 `@aws-sdk/client-bedrock-runtime`）报 Module not found。Web 作为 standalone runtime owner，直接声明 Mem0 3.1.6 入口静态加载的 `better-sqlite3`；其他未配置 provider peer（包括 `natural`、`compromise`）不安装。
- **运行时依赖边界**：Core 持有 `mem0ai`、`pg` 和 `@langchain/core` 的业务依赖；Gateway/Worker 的 tsup 产物内联 Core 后会从应用工作目录执行 `import("mem0ai/oss")`，因此两个应用也必须直接声明 `mem0ai`。Web 由 Next standalone 追踪 Core 的 server external，并通过 `.next/node_modules/mem0ai-*` alias 解析，无需重复声明。统一镜像让 Gateway/Worker 共享一个 pnpm virtual store；应用直接声明只补解析链接，不复制物理包。

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
