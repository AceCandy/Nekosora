# Memory System 契约

> chat 记忆系统（长期记忆 + 短期压缩）的核心契约。改记忆抽取/召回/注入/压缩时按此。

---

## Scenario: 三分类与生命周期

`user_memories.scope`：
- `preference`（偏好）：用户明确偏好，恒定注入，不过期，仅用户明确变更时覆盖。
- `profile`（身份）：用户客观事实，恒定注入，不过期，仅明确变更时覆盖。
- `project`（在做的事）：用户当前项目/领域，召回注入，1 周过期硬删。

| 类 | 注入 | 过期 | 更新时机 |
|---|---|---|---|
| preference / profile | 恒定（限量） | 不过期 | 用户明确变更（`confidence=explicit`）才覆盖 |
| project | 召回（topK） | 1 周（硬删） | 召回命中 / 重新抽取到 → 续命 1 周 |

---

## Scenario: 抽取（`src/lib/memory/extract.ts`）

- 流后异步，10 分钟全局频率保护。
- 一次 LLM 调用产出 `[{content, disclosure, scope, priority, confidence}]`（`confidence: explicit|weak`）。**0 额外 LLM**。
- 写入前去重（向量近邻 > 0.85，同 scope）：
  - preference/profile + `explicit` → 覆盖（UPDATE + 刷新 lastAccessedAt）
  - preference/profile + `weak` → 丢弃（保留原有）
  - project → 覆盖 + 刷新 lastAccessedAt（续命）
  - 不相似 → insert
- `embedding = embed(content + " " + disclosure)`（融合向量，同时编码「是什么」和「何时用」）。
- project 过期懒清理：入口 `DELETE WHERE scope='project' AND last_accessed_at < now()-7d`。
- **抽取范围排除「回答呈现类偏好」**：回答格式(markdown/HTML/表格)、回答风格(简洁/详细)、排版渲染(字体/配色)不进 preference——由系统设置的「输出模式」「输出样式」承担(`src/lib/output-modes`、`src/lib/render-styles`)。preference 只收与回答呈现无关的稳定偏好(语言、代码风格等)。靠 prompt 指令约束,不做关键词硬过滤(避免误伤)。

---

## Scenario: 召回与注入（`recall.ts` + `context-assembler.ts` + `orchestrator.ts`）

- preference / profile：恒定注入（preference cap 400，profile top N）。
- project：`recallMemories(userId, query)` 只查 project + 过期过滤（lastAccessedAt > now-7d）+ 融合向量 topK + 关键词兜底（embedding 不可用/无结果时 query 分词命中 content/disclosure）+ 命中刷新 lastAccessedAt。
- `assembleContext`：preference + profile 恒定 slot；project 召回 slot。

---

## Scenario: compact 质量增强（`src/lib/compact/service.ts`）

- 链式摘要：`buildSummary` 传 previous_summary（从 `context_snapshots` 取最近同分支 `summaryText`），LLM 合并更新，非从头重摘。**直接读 DB summaryText** 防注入格式漂移（kivio 教训：从注入的 system 消息抽取旧摘要会因格式不一致导致链式退化）。
- 质量兜底：摘要 < `MIN_SUMMARY_CHARS`(200) 拒绝覆盖旧 summary（防「收到✅」式短摘要污染）。
- 模型可配：`systemSettings.task.compact_model`，fallback 第一个 `visibility=public && enabled`。

---

## Scenario: 缓存（`src/lib/memory/service.ts`）

- `getMemories` 60s 缓存（`memories:${userId}`）。
- `invalidateMemoryCache(userId)` 在 `addMemory` / `updateMemory` / `deleteMemory` / `extractMemories` 后调用（`cacheDel`）。

---

## Gotcha

- **disclosure 抽取时固化**：召回不做 LLM 过滤，靠融合 embedding 实现「精准召回」，0 额外 LLM/往返。
- **身份/偏好恒定注入不刷新 lastAccessedAt**：诊断陈旧只判 project（走召回的才有「未命中」语义）；preference/profile 恒定注入用 lastAccessedAt 判陈旧会误标。
- **记忆与消息解耦**：会话删除/重生成不联动删记忆；不记来源消息 id（记忆是用户级，跨会话稳定）。
- **旧 embedding 清空重建**：迁移时 embedding/disclosure 置 NULL，旧记忆靠关键词兜底，新抽取渐进恢复融合向量。
- **updateMemory 手动编辑用 content-only embed**（已知遗留）：与融合向量略不一致，低频，靠关键词兜底兜住。
- **输出呈现偏好不抽取**：preference 不收录「回答怎么呈现」(格式/风格/排版),该域由输出模式/输出样式管;记忆与两者职责不重叠,避免重复注入与冲突。

---

## 相关

- `src/lib/memory/{service,recall,extract}.ts`
- `src/lib/compact/service.ts`
- `src/lib/context-assembler.ts`
- `src/lib/chat/orchestrator.ts`
- `src/app/(dash)/panel/memory/page.tsx`
- `src/lib/infra/cache.ts`（`cacheWrap` / `cacheDel`）
- `src/lib/rag/embedding.ts`（`embedText`）
- 调研存档：`docs/memory-system-audit.md`；任务：`07-11-chat-memory-enhancement`
