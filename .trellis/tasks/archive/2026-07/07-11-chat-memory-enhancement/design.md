# Design: chat 记忆系统重构

> 现状文件：`src/lib/memory/{service,recall,extract}.ts`、`src/lib/compact/service.ts`、`src/lib/context-assembler.ts`、`src/lib/chat/orchestrator.ts`、`src/app/(dash)/panel/memory/page.tsx`。改造点对照 `docs/memory-system-audit.md` 缺陷清单。

## 1. 数据模型变更（`user_memories`，`src/db/schema/{pg,sqlite}.ts`）

### 新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| disclosure | text | 「何时该用这条记忆」（抽取时 LLM 生成） |
| priority | int (default 0) | 重要性，scope 默认映射：preference=0 / profile=1 / project=2 |
| lastAccessedAt | timestamptz | 召回命中时异步刷新；project 过期判断依据 |

### 字段语义变更
- `scope` 值域改 `preference` | `profile` | `project`（原 `custom` → `project`，数据迁移）
- `embedding` 语义变更：`embed(content + " " + disclosure)`（融合向量，同时编码「是什么」和「何时用」）
- `source` / `content` / `createdAt` 不变

### 不新增字段（用户决策）
- 不加 `version` / `deprecated` / `migratedTo`（直接覆盖，不留版本）

### 迁移（双方言 `drizzle/pg/0011_*` + `drizzle/sqlite/0009_*`）
1. `ALTER TABLE user_memories ADD disclosure text, priority int DEFAULT 0, last_accessed_at timestamptz`
2. `UPDATE user_memories SET scope='project' WHERE scope='custom'`
3. `UPDATE user_memories SET priority = CASE scope WHEN 'preference' THEN 0 WHEN 'profile' THEN 1 ELSE 2 END`
4. `UPDATE user_memories SET last_accessed_at = created_at WHERE last_accessed_at IS NULL`
5. embedding 不回填（见 §1.1）

### 1.1 旧 embedding 不兼容处理（已定：清空重建）
融合向量改变 embedding 语义，旧 `embedding`（仅 content）与新 `embed(content+disclosure)` 不一致。采用**清空重建**：
- 迁移时 `UPDATE user_memories SET embedding = NULL, disclosure = NULL`（旧记忆无 disclosure）
- 旧记忆召回靠关键词兜底（embedding NULL 时跳过向量检索）
- 身份/偏好恒定注入不受影响（不靠 embedding）
- project 旧记忆靠关键词，且 1 周过期很快清理，影响可控
- 新抽取的记忆带 disclosure + 融合 embedding，渐进恢复正常召回质量

## 2. 抽取流程（`src/lib/memory/extract.ts` 重构）

输入：最近 6 轮对话（`RECENT_TURNS` 不变）。10 分钟全局频率保护（不变）。

### LLM 一次调用产出
```
[{content, disclosure, scope, priority, confidence}]
- content:    值得记住的稳定事实/偏好
- disclosure: 何时该想起（自然语言，如「讨论代码风格时」）
- scope:      preference/profile/project
- priority:   0-3（可不给则按 scope 默认）
- confidence: "explicit" | "weak"   ← 用于身份/偏好的「明确变更」判断
```

### 写入前去重（防膨胀）
对同 userId 现有记忆，用新 content embedding 做近邻检查（相似度 > 阈值，如 0.85）：
- **命中相似记忆**：
  - `preference` / `profile` 类：仅当 `confidence==="explicit"` 才覆盖（UPDATE content/disclosure/priority/embedding，刷新 lastAccessedAt）；`weak` 则丢弃（不记，保留原有）
  - `project` 类：直接覆盖 + 刷新 lastAccessedAt（续命 1 周）
- **未命中**：insert（lastAccessedAt = now）

### 「明确变更」判断 [待确认]
靠 LLM 输出 `confidence: explicit|weak` 标注。prompt 指示：用户明确陈述新事实/明确变更 → `explicit`；模糊、推测、临时的话 → `weak`。身份/偏好仅 `explicit` 才覆盖。
> 备选：不用 LLM 标注，改为「身份/偏好冲突时一律不覆盖，只新增不冲突的」——更保守但可能改不掉过时偏好。倾向 LLM 标注方案。

### project 1 周过期硬删（懒清理）
读取/抽取记忆时顺手：
```sql
DELETE FROM user_memories WHERE scope='project' AND last_accessed_at < now() - INTERVAL '7 days'
```
不另起 cron。在 `getMemories` / `extractMemories` 入口执行。

## 3. 召回流程（`src/lib/memory/recall.ts` + `service.ts` + `context-assembler.ts`）

### preference + profile：恒定注入
- `preference`：`buildPreferencePrompt` cap 400 字（不变）
- `profile`：`buildProfilePrompt` 恒定注入（限量 top N，**从召回改为恒定**——现状 profile 走召回不合理，身份不该因 query 没提就漏掉）

### project：召回注入
`recallMemories(userId, query)` 改为只查 `scope='project'`：
1. 过滤 `lastAccessedAt > now() - 7d`（过期不召回）
2. 融合向量检索：`embed(query)` 在 `embed(content+disclosure)` 上 topK
3. 命中 → 异步刷新 `lastAccessedAt`（续命）
4. 兜底：embedding 不可用 / 无结果 → query 分词命中 `content` / `disclosure` 关键词

### orchestrator.ts 调整（L176-188）
- `getMemories(userId)` 取全部（恒定注入 preference + profile；project 过期懒清理在此触发）
- `recallMemories(userId, query)` 只召回 project（过期过滤 + 融合向量 + 兜底）
- `assembleContext`：preference + profile 恒定 slot；project 召回 slot

### token 控制
身份 + 偏好恒定注入会增加 system token。preference cap 400（不变）+ profile 限量（top N 或字数 cap），project 召回 topK 限量。总量受 `assembleContext` 的 maxTokens 预算约束（已有）。

## 4. compact 质量增强（`src/lib/compact/service.ts`）

- **链式摘要**：`buildSummary` 传入 `previous_summary`（从已有 `context_snapshots` 取最近一条，或注入的 `[先前对话摘要]`），LLM 在其基础上合并更新，非从头重摘。识别 previous_summary 锚点（参考 kivio `extract_previous_summary`）。
- **质量兜底**：摘要结果 < `MIN_SUMMARY_CHARS`（如 200）拒绝覆盖旧 summary，回退保留原文或重试 L2。
- **模型可配**：摘要模型从「第一个 public+enabled」改为可配置（系统设置项，或固定专用模型），fallback 仍取第一个 public+enabled。

## 5. 诊断视图（`src/app/(dash)/panel/memory/page.tsx`）

记忆管理页加「健康检查」区（只读标记，不自动删）：
- **重复疑似**：同 userId 内 content 向量近邻 > 阈值的多条
- **陈旧**：preference / profile 类 `lastAccessedAt` 超过 N 天未命中（project 过期的已硬删，不在此）
- 用户手动清理（复用现有 delete）

## 6. 缓存修复（`src/lib/memory/service.ts` + `extract.ts`）

`invalidateMemoryCache(userId)` 真正实现：
- `addMemory` / `updateMemory` / `deleteMemory` 后失效 `memories:${userId}`
- `extractMemories` 写入后失效
- 依赖 `cacheWrap` 支持 invalidate（若不支持，改用版本号或直接 delete key）

## 7. 边界（与用户确认）

- **会话删除**：`context_snapshots` 级联删（已实现）；`user_memories` 不动（用户级解耦）
- **重新生成**：消息变 → `context_snapshots` pathHash 失效自动重算（已实现）；`user_memories` 不动（用户偏好不随 AI 答案变）
- **不记来源消息 id**：记忆与消息解耦

## 8. 已确认决策

1. 旧 embedding 不兼容处理：**清空重建**（§1.1）——迁移时 embedding/disclosure 置 NULL，旧记忆靠关键词兜底，渐进恢复
2. 「明确变更」判断：**LLM confidence 标注**（§2）——抽取输出 explicit/weak，身份/偏好仅 explicit 覆盖
3. 摘要模型可配：**系统设置项**（§4）——复用 systemSettings 配专用摘要模型，fallback 第一个 public+enabled

## 9. 已知遗留（本次不修）

- **updateMemory 手动编辑用 content-only embed**（`src/lib/memory/service.ts`）：手动编辑记忆时 `embedText(content)` 不含 disclosure，与抽取时的融合向量 `embed(content+disclosure)` 略不一致。影响：手动编辑后的记忆向量召回精度略降（关键词兜底仍可命中）。不修原因：手动编辑低频，UI 未暴露 disclosure 编辑；未来若加 disclosure 编辑可同步改融合 embed。
- **诊断陈旧仅判 project**（`src/lib/memory/recall.ts` getMemoryDiagnostics）：preference/profile 恒定注入不刷新 lastAccessedAt，用 lastAccessedAt 判陈旧会误标；故陈旧只判 project（走召回才有「未命中」语义）。project 1 周过期硬删，陈旧实际空，保留逻辑备未来调整（如 project 延长过期，或恒定注入也刷新 lastAccessedAt 让 preference/profile 陈旧反映「长期未对话」）。
