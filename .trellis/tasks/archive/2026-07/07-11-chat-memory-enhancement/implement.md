# Implement Plan: chat 记忆系统重构

> 每阶段尾部是验证 gate，过了再进下一阶段。改造点行号见 `design.md` + `docs/memory-system-audit.md`。

## 阶段 0: Schema + 迁移

- [ ] 0.1 `src/db/schema/{pg,sqlite}.ts`：`user_memories` 加 `disclosure` / `priority`(default 0) / `lastAccessedAt`
- [ ] 0.2 `pnpm db:generate:pg` + `db:generate:sqlite`，确认迁移含：ADD 三字段 + `custom`→`project` 数据转换 + 回填默认 priority + `last_accessed_at=created_at`
- [ ] 0.3 旧 embedding 清空重建：迁移时 `UPDATE user_memories SET embedding=NULL, disclosure=NULL`（design §1.1）
- **gate**：`pnpm typecheck`；本地 migrate 跑通，三字段建出，custom 数据转 project

## 阶段 1: 抽取重构（`src/lib/memory/extract.ts`）

- [ ] 1.1 LLM prompt 输出 `[{content, disclosure, scope, priority, confidence}]`；`parseExtracted` 同步扩展
- [ ] 1.2 写入前去重：向量近邻检查（相似度 > 0.85）
  - preference/profile：仅 `confidence==="explicit"` 覆盖（刷新 lastAccessedAt），weak 丢弃
  - project：覆盖 + 刷新 lastAccessedAt（续命）
- [ ] 1.3 project 1 周过期懒清理（`getMemories` / `extractMemories` 入口 `DELETE ... WHERE scope='project' AND last_accessed_at < now()-7d`）
- [ ] 1.4 `invalidateMemoryCache` 真正实现 + `extractMemories` 写入后调用
- **gate**：抽取单测（去重覆盖、过期清理、explicit/weak 分流）+ `pnpm test`

## 阶段 2: 召回重构（`src/lib/memory/recall.ts` + `service.ts` + `context-assembler.ts` + `orchestrator.ts`）

- [ ] 2.1 `recallMemories` 只查 `scope='project'` + 过期过滤 + 融合向量（embed query 对 embed(content+disclosure)）+ 关键词兜底 + 命中刷新 lastAccessedAt
- [ ] 2.2 `buildProfilePrompt` / `assembleContext`：profile 改恒定注入（限量），project 召回 slot
- [ ] 2.3 `orchestrator.ts` L176-188 调整：preference+profile 恒定，project 召回
- [ ] 2.4 抽取写入时 embedding 改 `embed(content + " " + disclosure)`
- **gate**：召回单测（融合向量命中、关键词兜底、过期过滤、恒定 vs 召回分流）+ `pnpm test`

## 阶段 3: compact 质量增强（`src/lib/compact/service.ts`）

- [ ] 3.1 链式摘要：`buildSummary` 传入 previous_summary，LLM 合并更新（识别锚点防格式漂移）
- [ ] 3.2 质量兜底：摘要 < `MIN_SUMMARY_CHARS`（200）拒绝覆盖旧 summary，回退 L2/保留原文
- [ ] 3.3 摘要模型可配（系统设置项或专用模型，fallback 第一个 public+enabled）
- **gate**：`pnpm typecheck` + compact 单测（链式合并、质量兜底拒绝短摘要）

## 阶段 4: 诊断视图 + UI

- [ ] 4.1 `src/app/(dash)/panel/memory/page.tsx` 加健康检查区（重复疑似 / 陈旧标记），复用现有 delete
- [ ] 4.2 i18n `messages/{zh-CN,en}.json` 同步
- **gate**：`pnpm lint` + `pnpm typecheck`；手动验收诊断标记

## 阶段 5: 全量验证 + 收尾

- [ ] 5.1 `pnpm lint` + `pnpm typecheck` + `pnpm test` 全绿
- [ ] 5.2 `trellis-check` 全范围复核
- [ ] 5.3 手动验收：抽取去重、project 过期、召回精准度、compact 链式、诊断视图
- [ ] 5.4 沉淀 spec（memory 相关契约，按需更新/新增）+ finish-work

## Review Gates 汇总

| 阶段 | 必过 |
|---|---|
| 0 | typecheck + 本地 migrate 建字段 + custom→project |
| 1 | 抽取单测（去重/过期/explicit-weak）+ test |
| 2 | 召回单测（融合向量/兜底/过期/分流）+ test |
| 3 | typecheck + compact 单测（链式/兜底）|
| 4 | lint + typecheck + 手动诊断 |
| 5 | lint + typecheck + test + trellis-check |

## 风险锚点

- **抽取去重的「明确变更」判断**依赖 LLM `confidence` 标注，prompt 要严格（design §2）
- **融合向量**改变 embedding 语义，旧 embedding 清空重建（design §1.1）——短期内旧记忆召回靠关键词，身份/偏好恒定注入不受影响
- **profile 改恒定注入**增加 system token，必须限量（preference cap 400 + profile top N）
- **compact 链式摘要**要正确识别 previous_summary 锚点，避免格式漂移导致跨轮丢上下文（参考 kivio `extract_previous_summary` 教训）
- **懒清理 DELETE** 要确保不影响并发召回（小表，风险低，但注意事务）
