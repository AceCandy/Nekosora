# PRD: chat 记忆系统重构

## 背景

当前 chat 记忆系统（`src/lib/memory/` + `src/lib/compact/`）骨架借鉴 DEEIX-Chat，已有「长期记忆（自动抽取 + 向量召回）+ 短期压缩（compact）」双层架构，并率先实现了 LLM 自动抽取（参考项目 AQBot/DEEIX/kivio 均无自动抽取）。

但存在三类核心缺陷（详见 `docs/memory-system-audit.md`）：
1. **无限膨胀**：抽取只 insert 不去重，同一偏好反复积累
2. **召回不准**：纯向量盲盒（阈值 0.45 硬切），无触发条件
3. **覆盖不可恢复 + 缓存空实现**：`updateMemory` 直接覆盖；`invalidateMemoryCache` 是空函数（手动增删后 60s 内仍注入旧记忆）

本次在现有架构上做「质量增强」，不推倒、不扩张，不引入 agent 工具循环。

## 目标

- **抽取质量**：识别真正稳定的记忆，去重防膨胀，按类管理生命周期
- **召回精准**：从盲盒相似度升级为「融合触发条件的精准召回」
- **活性管理**：project 类时效过期，身份/偏好稳定保留，死记忆可识别

## 范围

### 做
- `user_memories` 加字段（disclosure / priority / lastAccessedAt），`custom` → `project`
- 抽取重构：一次 LLM 产出 content + disclosure + scope + priority；去重覆盖；分类生命周期
- 召回重构：融合向量（content + disclosure）+ 关键词兜底；profile 改恒定注入；project 1 周过滤
- compact 质量增强：链式摘要 + 质量兜底 + 模型可配
- 诊断视图：记忆管理页标记重复/陈旧/冲突
- 缓存修复：`invalidateMemoryCache` 真正实现

### 不做（明确排除）
- 不做 agent 工具循环（主权写入留给后续角色培养功能）
- 不做消息分片语义召回（DEEIX `chat_message_chunks`，P2 以后）
- 不做版本链/回滚（直接覆盖，用户确认）
- 不做记忆来源消息追踪（记忆与消息解耦，用户确认）
- 不做会话删除/重生成联动删记忆（解耦，用户确认）
- 不改 compact 架构（只做质量增强）
- 不动网关路由（gateway-routing spec 不受影响）

## 已确认的设计决策

1. 用户级跨会话记忆，不做单会话记忆层（会话内靠上下文 + compact）
2. 三分类：身份(profile) / 偏好(preference) / 在做的事(project，原 custom)
3. 直接覆盖，不留版本、不回滚
4. 身份/偏好：不过期，仅用户明确变更时覆盖；冲突时只认明确变更，模糊的不覆盖
5. project：1 周过期硬删；刷新时机 = 召回命中 or 重新抽取到（续命 1 周）
6. 注入策略：身份 + 偏好恒定注入（限量），project 召回注入
7. disclosure 字段：抽取时 LLM 生成「何时用」，与 content 融合 embed，0 额外 LLM 调用
8. 召回兜底：embedding 不可用/无结果时关键词匹配
9. 身份从召回改为恒定注入（现状 profile 走召回不合理）
10. compact 质量增强直接做（链式 + 兜底 + 模型可配）
11. 会话删除/重生成不联动删记忆；不记来源消息
12. 缓存修复
13. 诊断视图（不自动删身份/偏好，只标记让用户清理；project 靠 1 周过期硬删）

## 验收标准

- [ ] `user_memories` 新字段迁移（sqlite + pg 双方言），`custom` 数据转 `project`
- [ ] 抽取产出 disclosure/priority；去重覆盖（同 userId 相似记忆覆盖而非新增）；身份/偏好冲突仅明确变更覆盖；project 1 周过期硬删
- [ ] 召回融合向量 + 关键词兜底；profile 恒定注入；project 过期过滤；命中刷新 lastAccessedAt
- [ ] compact 链式摘要（合并 previous summary）+ 质量兜底（min chars）+ 模型可配
- [ ] 诊断视图标记重复/陈旧/冲突
- [ ] `invalidateMemoryCache` 真正实现（增删改 + 抽取后失效）
- [ ] typecheck/lint/test 全绿；memory 相关单测覆盖
- [ ] 不破坏现有 chat/compact 主流程，不影响网关

## 约束

- 0 额外 LLM 调用、0 额外往返（disclosure 靠抽取时固化，不召回时过滤）
- 多模型网关兼容（抽取 prompt 不依赖特定模型遵循纪律）
- 双 DB 方言（pg + sqlite）同步
- 融合向量改变 embedding 语义，旧 embedding 需处理（懒重生成或清空重建）
