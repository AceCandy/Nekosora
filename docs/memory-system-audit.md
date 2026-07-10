# Nekosora 记忆系统调研存档

> **日期**：2026-07-10
> **范围**：① 当前项目记忆系统实现 ② `docs/cankao` 下参考项目（AQBot / DEEIX-Chat / kivio / nocturne_memory）③ 业界 chat 记忆方案（Mem0 / MemGPT-Letta / Zep / OpenAI / 学术分类）
> **方法**：当前项目逐文件源码核查；参考项目逐文件源码 + 文档核查；业界方案多源交叉核查。不含运行时验证。

---

## 执行摘要

当前项目的记忆系统是「**长期记忆 + 短期压缩**」双层架构，骨架借鉴自参考项目 **DEEIX-Chat**（代码注释明示），并在此基础上多走一步——**增加了 LLM 自动抽取**（AQBot / DEEIX / kivio 三个参考项目均为纯手动写入，无自动抽取）。整体完成度在参考项目里属中上。

相比业界成熟方案与 nocturne_memory，主要差距集中在三处：**记忆无限膨胀（无 consolidation）**、**召回不准（纯向量盲盒）**、**覆盖不可恢复（直接 UPDATE）**。nocturne_memory 的「第一人称主权记忆」哲学与咱们场景相反、整体不可照搬，但其 `disclosure` 触发条件、版本链、陈旧度信号、诊断视图四个机制恰好闭环补上上述缺陷。

---

## 一、当前项目记忆系统实现

### 1.1 架构总览

```
用户发送消息 (src/app/api/chat/route.ts)
  │
  ├─【流前】src/lib/chat/orchestrator.ts:176-267 组装上下文
  │    ├─ getMemories()           全量取用户记忆(60s缓存)
  │    ├─ recallMemories()        用当前query向量召回 profile/custom top5
  │    │    └─ preference全量 + profile/custom召回替换
  │    ├─ maybeCompact()          双触发压缩→生成摘要
  │    └─ assembleContext()       槽位式注入为聚合 system 消息
  │
  └─【流后】route.ts:344 异步 extractMemories()
       └─ LLM从最近6轮提取偏好/事实 → embed → 写入 user_memories
```

### 1.2 长期记忆层 `src/lib/memory/`

**数据表 `user_memories`**（`src/db/schema/pg.ts:662`，SQLite 同构 `src/db/schema/sqlite.ts`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text PK | uuid |
| userId | text → user | 级联删除 |
| scope | text | `preference` / `profile` / `custom` |
| source | text | `manual` / `ai` |
| content | text | 记忆正文 |
| embedding | vector(1536) | pgvector；SQLite 走内存余弦 |
| createdAt | timestamptz | — |

**四个核心模块：**

| 模块 | 文件 | 职责 |
|---|---|---|
| service | `src/lib/memory/service.ts` | CRUD + 60s 读缓存（`cacheWrap("memories:${userId}")`）+ 槽位文本构造（preference cap 400 字，profile top5） |
| recall | `src/lib/memory/recall.ts` | 语义召回：PG 用 pgvector `<=>`，SQLite 内存余弦；阈值 `DEFAULT_MIN_SIMILARITY=0.45`；topK=5；只召回 profile/custom |
| extract | `src/lib/memory/extract.ts` | 流后异步 LLM 抽取：取最近 6 轮（`RECENT_TURNS=6`），10 分钟频率保护，输出 JSON 数组，每条 embed 写入，最多 5 条，失败静默 |
| 注入 | `src/lib/context-assembler.ts` | 槽位式：SlotSystem / SlotTemplate / SlotFile / SlotCompaction / SlotPreference / SlotProfile → 合并成一条 system |

**召回与注入策略**（`orchestrator.ts:177-188`）：
- `preference` scope → 全量注入（cap 400 字）
- `profile` / `custom` scope → 语义召回 top5（用当前 user 消息作 query）
- 召回失败 → 回退全量

### 1.3 短期压缩层 `src/lib/compact/service.ts`

**数据表 `context_snapshots`**（`pg.ts:528`）：含 `coveragePathHash`（滚动 SHA）、`coveredMessageCount`、`summaryText`、`strategy`。

| 机制 | 实现 |
|---|---|
| 双触发 | `turn_cap`（用户轮次 > `DEFAULT_MAX_TURNS=16`）/ `token_cap`（token > `DEFAULT_COMPACT_TRIGGER_TOKENS=12000`） |
| 分割 | 保留最近 `DEFAULT_PRESERVE_RECENT=8` 轮原文，旧消息进摘要 |
| 快照复用 | `CoveragePathHash` 匹配前缀 → 直接复用（分支安全） |
| 4 级回退 | L3 LLM全量 → L2 LLM精简(后半) → L1 模板 → L0 空 |
| 熔断器 | 连续失败 `MAX_COMPACT_FAILURES=3` 次冷却 `FAILURE_COOLDOWN_MS=5min` |
| 摘要模型 | 取第一个 `visibility=public && enabled` 模型（`service.ts:220`） |

### 1.4 用户侧 `src/app/(dash)/panel/memory/page.tsx`

表格展示所有记忆（scope/source 徽标），支持内联编辑（`updateMemory` 会重生成 embedding）、删除、按 scope 新增。删除已改为内联 server action（见 commit `f0a4052`）。

---

## 二、参考项目（`docs/cankao`）记忆系统对比

### 2.1 总览

| 项目 | 长期记忆 | 架构 | 检索 | 写入方式 | 自动抽取 |
|---|:---:|---|---|---|:---:|
| **AQBot** | ✅ | namespace+item RAG | 向量+可选rerank | 手动 | ❌ |
| **DEEIX-Chat** | ✅ | KV记忆+消息分片召回+4级压缩 | 向量+关键词兜底 | 手动 API | ❌ |
| **kivio** | ✅ | L1/L2 双层文件 | L1全量+L2关键词分节 | Agent 工具自主 | ❌ |
| **nocturne_memory** | ✅ | Node-Memory-Edge-Path 图谱 | FTS+bm25（非向量） | AI MCP 工具显式 | ❌ |
| AMC-WebUI | ❌ | 仅上下文窗口保护（媒体省略） | — | — | — |
| SQLBot | ❌ | embedding 用于 NL2SQL 表匹配 | — | — | — |
| sub2api | ❌ | API 网关转发 embeddings 端点 | — | — | — |
| tokui | ❌ | 无任何记忆实现 | — | — | — |

### 2.2 AQBot — RAG 向量记忆 + 滑窗/摘要压缩

- **存储**：`memory_namespaces`（每 namespace 独立 embedding 配置：维度/阈值/top_k）/ `memory_items`（`source: manual|auto_extract`，但 `auto_extract` 仅作标签，无实际抽取链路）/ `conversation_summaries`；向量存外部 vector_store，collection = `mem_{namespace_id}`，与知识库共用 `RAGSource` trait。
- **检索**：`search_memory` → 向量检索后按 `retrieval_threshold` 过滤、`retrieval_top_k` 截断；知识库支持 rerank（Cohere/Jina），记忆暂无。
- **注入**：`collect_rag_context` 拼成 `[memory]\n<内容>` system 消息（`conversations.rs:3703`）。
- **压缩**：双模式（滑窗 / LLM 摘要），自动触发 = 窗口 × 70%，rolling merge 已有摘要。
- **关键文件**：`AQBot/src-tauri/crates/core/src/rag.rs`、`AQBot/src-tauri/src/commands/memory.rs`、`AQBot/src-tauri/src/context_manager.rs`。
- **可借鉴**：namespace 维度隔离 + 独立 embedding 配置；记忆与知识库共用 RAG 抽象；索引状态机 + 前端实时事件。

### 2.3 DEEIX-Chat — KV 用户记忆 + 消息语义召回 + 4 级摘要（当前项目直接借鉴源）

- **存储**：`user_memories`（`memory_key` unique, `value`, `scope`, `embedding`）+ `chat_message_chunks`（对话消息分片向量化，用于历史语义召回）+ `context_snapshots`。双向量适配：PG pgvector 内联+ivfflat；SQLite sqlite-vec 独立表。
- **检索**：用户记忆优先向量（topK=5, minSimilarity=0.7），超时/无 embedding **回退关键词匹配**；历史消息 `SearchMessageChunks`（topK=5, 0.75, 200ms 超时）。按 scope 分流：preference 全量，profile/custom 相关性筛选。
- **注入**：XML 结构化 `<ctx>`（`<sum>/<mems>/<recall>/<rag>/<evs>/<q>`），`ContextArtifact` 统一记录证据引用（`semantic_recall`/`user_memory`/`file_rag_chunk`/`conversation_summary`）可溯源。
- **压缩**：4 级回退（L3 LLM全量 9 章节 / L2 LLM精简 / L1 增强模板 / L0 空）+ 熔断器 + 5min 自恢复 + `CoveragePathHash`。
- **关键文件**：`DEEIX-Chat/backend/internal/application/memory/service.go`、`.../conversation/service_message_context.go`、`.../compact/service.go`、`.../conversation/service_generation_support.go`。
- **可借鉴**：向量+关键词双策略；消息分片语义召回；4 级回退+熔断；`ContextArtifact` 证据溯源；XML 结构化注入。

### 2.4 kivio — L1/L2 双层文件记忆 + Claude Code 式压缩

- **存储**：纯文件 `{app_data}/chat-memory/L1.md` + `L2.md`，L1 上限 `L1_MAX_BYTES=5000`，原子写入。
- **写入**：Agent 通过 MCP 工具 `memory_modify`（append/replace/remove/archive），`ensure_unique_match` 要求精确唯一匹配（0 或多匹配均报错）。
- **检索**：L1 全量注入；L2 关键词 token 分节匹配（`search_sections`，heading 命中权重 ×2），非向量。
- **安全**：`validate_secret_free` 写入前检测 `api_key`/`sk-`/`bearer`/`ignore previous instructions` 等，命中拒绝。
- **压缩**（高度对齐 Claude Code）：`AUTO_COMPACT_RATIO=0.90` 触发 / `RECENT_KEEP_TOKENS=20000` 近期保护 / **microcompact**（先降级旧工具输出再决定是否 LLM 摘要）/ 9 段结构化摘要 prompt / **链式摘要**（合并 previous summary）/ `MIN_SUMMARY_CHARS=200` 质量兜底 / `DECAY_WARNING_COMPRESSION_COUNT=3` 衰减告警 / 摘要输入预算 0.5×窗口防超窗 / 头尾裁剪 40%/60%。
- **关键文件**：`kivio/src-tauri/src/chat/memory.rs`、`kivio/src-tauri/src/chat/agent/compaction.rs`、`kivio/src-tauri/src/chat/commands.rs:186`。
- **可借鉴**：L1/L2 分层注入成本控制；安全校验；Claude Code 式压缩质量工程（microcompact + 链式 + 质量兜底 + 衰减告警）。

### 2.5 nocturne_memory — MCP 长期记忆服务器（第一人称主权记忆）

- **定位**：基于 MCP 协议的长期记忆服务器，让 AI 跨会话/跨模型记住「自己是谁」。**明确反对向量 RAG、反对后台自动抽取、反对自动摘要**，主张 AI 自己决定记什么/怎么组织/何时回忆。
- **存储**：关系库四实体有向图 —— `nodes`(概念锚点, UUID 跨版本不变) / `memories`(内容版本, `deprecated`+`migrated_to` 版本链) / `edges`(`priority`+`disclosure`) / `paths`(URI 路由, namespace 多 Agent 隔离)。无 `embedding`/`confidence`/`scope`，重要性用 `priority`，召回时机用人类可读 `disclosure` 字符串。
- **写入**：无自动抽取。AI 在对话中显式调 7 个 MCP 工具（`read/create/update/delete_memory`、`add_alias`、`manage_triggers`、`search_memory`），靠 `system_prompt.md` 操作规范驱动。
- **consolidation**：非算法，AI 主导认知维护。`update` 新建行 + deprecate 旧行（可回滚 `rollback_to_memory`）；诊断视图 `get_diagnostics` 报 `duplicate_aliases`/`orphaned_nodes`/`stale_nodes`；一套记忆审计 Skill（信念对决 / 死数据清洗 / 模式提取 / 节点拆分 / 可发现性）做 prompt 级合并决策；防连续改写熔断。
- **检索**：FTS + bm25（非向量），priority 加权，按 node 去重 top-K；`disclosure` 靠 AI 自判命中；兜底用 `system://index`/`recent`/`glossary`/`diagnostic`/`random` 等系统 URI。
- **注入**：AI 主动 `read_memory` 才注入（工具返回），不后台注入 system；`system://boot` 每会话加载核心身份。
- **特色**：版本链可回滚 + 人类审计 Dashboard + Glossary（Aho-Corasick 关键词自动超链接）+ priority 分级陈旧度（priority N → `3.5×2^N` 天阈值）+ 做梦式随机审计 + namespace 隔离。
- **未实现**：无短期记忆/对话压缩；无 token 预算控制；无自动去重/遗忘；无置信度字段。
- **关键文件**：`nocturne_memory/backend/db/models.py`、`.../db/graph.py`（`GraphService`）、`.../db/search.py`、`.../db/glossary.py`、`.../db/snapshot.py`、`.../mcp_server.py`、`.../system_views.py`、`nocturne_memory/docs/skills/memory-audit*/SKILL.md`。

---

## 三、业界 chat 记忆系统方案

### 3.1 学术分类（记忆三维度）

依据 2025 综述（arXiv 2504.15965 / ACM 综述）：
- **时间跨度**：短期（上下文窗口内）/ 长期（跨会话持久化）
- **内容类型**：情景（episodic，具体事件）/ 语义（semantic，抽象事实）/ 程序（procedural，技能流程）
- **读写模式**：系统驱动（system-managed）vs Agent 自主（agent-managed）

### 3.2 主流框架对比

| 框架 | 模式 | 提取 | 合并/去重 | 检索 | 核心创新 |
|---|---|---|---|---|---|
| **Mem0** | 系统驱动 | 自动抽取显著事实 | 动态 consolidation（去重/合并/更新） | 向量 retrieve-and-inject | 生产级 extract-and-retrieve 基线 |
| **MemGPT/Letta** | Agent 自主 | Agent 决定 page in/out | Agent 自编辑记忆块 | OS 式分页（主上下文=RAM，归档=disk） | OS 式运行时 |
| **Zep** | 系统驱动 | 实体/关系抽取 | 时序演化（事实带时间戳，自动处理矛盾） | 图查询+向量 | 时序知识图谱 Graphiti |
| **OpenAI ChatGPT** | 系统驱动 | 自动抽取关键用户细节 | 扁平列表 | 全量注入 | saved-facts 列表 + 用户手动控制 |

一句话：**Mem0 管记忆给 agent 用；Letta 让 agent 自己管记忆；Zep 用时序图追踪事实演化。**

---

## 四、差距分析

### 4.1 当前项目已具备（优点）

- ✅ 双层架构（长期+短期），骨架完整
- ✅ **LLM 自动抽取**——三个参考项目都没有，当前项目最超前的点
- ✅ 向量召回（pgvector + SQLite 双适配）+ preference/profile 分流注入
- ✅ 压缩快照复用（CoveragePathHash）+ 熔断器——工程鲁棒性已对齐 DEEIX
- ✅ 用户可手动增删改 + UI

### 4.2 明确缺陷（基于代码事实）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| 1 | `src/lib/memory/extract.ts:125-129` | `invalidateMemoryCache` 是空实现（注释承认依赖 TTL 过期） | 手动增删记忆后 60s 内仍注入旧记忆，一致性 bug |
| 2 | `src/lib/memory/extract.ts:74-87` | 抽取只 insert 不去重/不更新 | 同一偏好反复积累，记忆无限膨胀（无 Mem0 consolidation） |
| 3 | `src/lib/memory/service.ts:80-85` | preference cap 400 字硬 `slice` | 可能截断在词/句中间 |
| 4 | `src/lib/compact/service.ts:212-226` | 摘要模型取「第一个 public+enabled」，不可控 | 可能用不擅长摘要的模型 |
| 5 | `src/lib/memory/recall.ts` | 阈值固定 0.45，无调参/无关键词兜底 | embedding 不可用时直接返回空，profile 丢失 |
| 6 | `src/lib/memory/service.ts:54-69` | `updateMemory` 直接 UPDATE 覆盖 | 旧内容丢失，抽取污染后无法恢复 |
| 7 | 全局 | 无 `lastAccessedAt`/`priority` 等活性信号 | 无法识别死记忆/陈旧记忆 |

### 4.3 对比参考项目缺失的进阶项

| 缺失项 | 借鉴来源 | 价值 |
|---|---|---|
| 消息分片语义召回 | DEEIX `chat_message_chunks` | 长会话找回具体历史细节 |
| 关键词兜底检索 | DEEIX `selectRelevantMemories` | embedding 不可用时记忆不丢 |
| XML 结构化注入 + 证据溯源 `ContextArtifact` | DEEIX | 注入可审计、可溯源 |
| microcompact + 链式摘要 + 质量兜底 + 衰减告警 | kivio/Claude Code | 摘要质量、防漂移 |
| 安全校验（防密钥 + 防注入） | kivio `validate_secret_free` | 记忆不被污染为注入载体 |
| `disclosure` 触发条件字段 | nocturne | 召回从盲盒变精准 |
| 版本链可回滚 | nocturne `migrated_to`+`deprecated` | 防覆盖丢失 |
| 陈旧度信号 + 访问日志 | nocturne priority 分级 | 死记忆识别 |
| 诊断视图 | nocturne `get_diagnostics` | 记忆健康可视化 |

### 4.4 对比业界缺失的进阶项

| 缺失项 | 业界来源 | 价值 |
|---|---|---|
| 记忆 consolidation（去重/合并/更新/失效） | Mem0 | 防膨胀、保持新鲜 |
| 时序/事实演化（带时间戳、自动处理矛盾） | Zep | 区分「3 月的职位 vs 现在」 |
| 记忆置信度 + 时间衰减/遗忘 | 学术综述 | 老旧低质记忆自动淡出 |
| Agent 自主记忆工具（read/search/modify） | MemGPT/kivio | LLM 自己决定记什么 |

---

## 五、改进建议（合并优先级）

### P0 — 修缺陷（低风险、diff 小）

1. **实现 `invalidateMemoryCache`**：`addMemory`/`updateMemory`/`deleteMemory`/`extractMemories` 后主动失效 `memories:${userId}` 缓存（当前空函数，一致性 bug）。
2. **extract 去重 + 陈旧度信号**：写入前对同 userId+scope 做文本/向量近邻检查，命中则 update 而非 insert；给 `user_memories` 加 `priority`/`lastAccessedAt`，配合陈旧度检测解决无限膨胀。

### P1 — 借鉴参考项目增强

3. **召回关键词兜底**（DEEIX）：embedding 不可用/无结果时按 query 分词命中 content 兜底，避免 profile 丢失。
4. **`disclosure` 触发条件字段**（nocturne）：`user_memories` 加 `disclosure`；抽取时 LLM 同时生成「何时用这条记忆」的触发描述；召回向量初筛 + disclosure 语义二次加权/过滤。
5. **版本链可回滚**（nocturne）：`updateMemory` 改为新建行 + deprecate 旧行 + `migrated_to` 版本链，防错误抽取覆盖好记忆。
6. **compact 质量工程**（kivio/Claude Code）：链式摘要（传 previous_summary 合并）、`MIN_SUMMARY_CHARS` 质量兜底、累计压缩 N 次衰减告警、microcompact（先降级旧工具输出）。
7. **记忆安全校验**（kivio `validate_secret_free`）：写入前检测 `api_key`/`sk-`/`ignore previous instructions` 等特征，拒绝污染。
8. **摘要模型可配**：compact 用专用摘要模型或用户当前模型，而非「第一个 public+enabled」。

### P2 — 业界进阶（架构演进）

9. **消息分片语义召回**（DEEIX `chat_message_chunks`）：每轮对话异步分片向量化，历史可按语义召回单条。
10. **证据溯源 `ContextArtifact`**（DEEIX）：记录每次注入选了哪些记忆/摘要/召回，前端展示「这条回复用了哪些记忆」。
11. **诊断视图**（nocturne `get_diagnostics`）：记忆管理页加「健康检查」——疑似重复、长期未命中、可疑冲突。
12. **完整 consolidation**（Mem0）：抽取后做 ADD / UPDATE / DELETE / NOOP 四分类，实现记忆新陈代谢。
13. **时间衰减 + 置信度**：记忆带 `lastUsedAt`/`hitCount`，长期未命中且低置信的记忆降权或归档。

---

## 六、Nocturne Memory 专题：可借鉴 vs 不可照搬

nocturne_memory 的「第一人称主权记忆」哲学与咱们场景**几乎完全相反**，整体不可照搬。

### 6.1 不可照搬（哲学/场景不匹配）

| 不可照搬项 | 原因 |
|---|---|
| 放弃向量改 FTS | 它反向量是哲学选择非普适最优；咱们中文短句相似度召回，向量更合适 |
| AI 自主工具读写记忆 | 咱们单轮请求-响应，无 agent 工具循环，必须系统注入 |
| 放弃自动抽取 | 咱们用户群（普通用户聊天工作台）决定了必须自动 |
| 信念对决 / 做梦审计 / 人格 Boot 协议 | AI 自我认知场景产物，工具型聊天投入产出比低 |
| Glossary 关键词超链接 | 工程量大，优先级低，先放着 |

### 6.2 可借鉴（4 个机制，闭环补缺陷）

| # | 机制 | 补的缺陷 | 落地难度 |
|---|---|---|---|
| 1 | `disclosure` 触发条件字段 | 召回不准（纯向量盲盒） | 中 |
| 2 | 版本链 `migrated_to`+`deprecated` | 覆盖不可恢复 | 中 |
| 3 | `priority`+`last_accessed_at`+访问日志 → 陈旧度 | 无限膨胀（无活性信号） | 中 |
| 4 | 诊断视图（重复/孤儿/陈旧/冲突） | 记忆健康不可见 | 低 |

⚠️ 机制 1（disclosure）的「语义二次过滤」具体实现（再调一次 LLM？还是 embedding 比对？）需设计时定，避免引入额外召回延迟。

---

## Sources

- [A Survey on Memory Mechanisms in the Era of LLMs (arXiv 2504.15965)](https://arxiv.org/html/2504.15965v1)
- [A Survey on the Memory Mechanism of LLM Based Agents (ACM)](https://dl.acm.org/doi/10.1145/3748302)
- [Mem0: Building Production-Ready AI Agents (arXiv 2504.19413)](https://arxiv.org/html/2504.19413v1)
- [Zep: A Temporal Knowledge Graph Architecture (arXiv 2501.13956)](https://arxiv.org/html/2501.13956v1)
- [Agent Memory Frameworks Tested: Mem0 vs Zep vs Letta](https://particula.tech/blog/agent-memory-frameworks-tested-mem0-zep-letta-cognee-2026)
- [Mem0 vs Letta: Which AI Memory Solution?](https://gamgee.ai/vs/mem0-vs-letta/)
- [Zep vs Mem0 — Atlan](https://atlan.com/know/zep-vs-mem0/)
- [Agent Memory Architectures: 5 Patterns (Atlan)](https://atlan.com/know/agent-memory-architectures/)
- [Design Patterns for Long-Term Memory in LLM Architectures (Serokell)](https://serokell.io/blog/design-patterns-for-long-term-memory-in-llm-powered-architectures)

---

## 附录：当前项目记忆系统关键文件速查

| 用途 | 路径 |
|---|---|
| 长期记忆表 schema | `src/db/schema/pg.ts:662`（`user_memories`）、`src/db/schema/sqlite.ts` |
| 压缩快照表 schema | `src/db/schema/pg.ts:528`（`context_snapshots`） |
| 记忆 CRUD + 槽位构造 | `src/lib/memory/service.ts` |
| 语义召回 | `src/lib/memory/recall.ts` |
| LLM 自动抽取 | `src/lib/memory/extract.ts` |
| 上下文槽位组装 | `src/lib/context-assembler.ts` |
| 会话压缩 | `src/lib/compact/service.ts`（`maybeCompact`） |
| 压缩覆盖哈希 | `src/lib/compact/coverage.ts` |
| 编排（记忆+压缩+注入串联） | `src/lib/chat/orchestrator.ts:176-267` |
| 抽取触发入口 | `src/app/api/chat/route.ts:344` |
| 用户记忆管理 UI | `src/app/(dash)/panel/memory/page.tsx` |
| 向量基础设施 | `src/lib/infra/vector.ts`（`DEFAULT_MIN_SIMILARITY=0.45`） |
| embedding | `src/lib/rag/embedding.ts` |
