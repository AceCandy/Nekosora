# Kimi Fixed Reasoning Drift Research

## Confirmed Data Chain

```text
0000 baseline
  Kimi K2.7 fixed + only high:"default"
    -> 0001 sync migration
       fixed + {off:null}
         -> getSupportedReasoningLevels
            missing minimal/low/medium/high use generic defaults
              -> [minimal, low, medium, high]
                -> ChatToolbar renders adjustable slider
                  -> fixed request translator ignores every selected level
```

- `drizzle/pg/0000_baseline.sql:664-665`：两款 Kimi 初始 fixed map 完整且只有 high 非空。
- `drizzle/pg/0001_sync_pi_models.sql:142-152`：后续 upsert 把 map 整体覆盖为 `{off:null}`。
- `src/lib/reasoning.ts:18-25`：off 为 null 被过滤；minimal/low/medium/high 缺省时仍返回 true，xhigh/max 才要求显式映射。
- `src/features/chat/components/ChatToolbar.tsx:259-264`：档位数大于 1 被视为可调，只有单档才标记 fixed。
- `src/lib/reasoning.ts:78-83`：`thinkingFormat: fixed` 不修改请求体，所以四档切换全部是 no-op。

## External Evidence

2026-07-26 使用 `agent-browser read https://pi.dev/api/models --raw` 核验 Moonshot 官方 provider 条目：

- `kimi-k2.7-code` 与 `kimi-k2.7-code-highspeed`
- `api: "openai-completions"`
- `reasoning: true`
- `compat.thinkingFormat: "deepseek"`
- `compat.supportsReasoningEffort: false`
- `thinkingLevelMap: { "off": null }`

这组数据表达“推理不可关闭、没有独立强度字段”。项目模型目录对这类模型使用 `fixed`，让 Chat 显示固定开启且运行时不伪造启停/强度参数；pi 的 `{off:null}` 不能直接成为 fixed map，因为项目 fixed 契约还要求一个显式内部开启档。

## Root Cause

`src/lib/sync-pi-models.ts:297-304` 的格式解析知道 `fixed` 是项目 curated 语义并优先保留；但 `resolveThinkingLevelMap` 在 `:310-314` 独立看到 pi 的 `deepseek` 格式和 map 后直接采用 `{off:null}`。格式和 map 的所有权判断不一致，生成了语义不完整的混合配置。

同步闸门 `passesInvariants` 复用通用档位解析；缺省四档被误认为存在，因此 `{off:null}` 仍通过“大于零”检查。测试只覆盖完整 fixed map，没有覆盖 fixed + sparse pi map 的同步交叉场景。

## Why Data-Only Repair Is Insufficient

只新增数据库 UPDATE 能暂时修复现存行，但下一次运行 `scripts/sync-pi-models.ts --write/--apply` 时仍会重新采用 pi map。只改同步脚本也不会修复已经执行过 `0001` 的数据库。只改 UI 会在前端复制目录能力判断，违反 `model_catalog` 唯一事实源原则。

完整闭环需要：

1. runtime 对 fixed 只认显式档位，避免坏数据渲染假控件；
2. sync 保留 fixed curated map，并要求恰好一个档位；
3. 新迁移修复存量两行；
4. 测试同时锁定三层。

## Minimal Change Boundary

- `getSupportedReasoningLevels` 增加 fixed 分支，不改其他 format。
- `resolveThinkingLevelMap` 在 pi map 覆盖前短路 fixed，沿用现有 map 的空串规范化。
- `passesInvariants` 对 fixed 检查 length === 1；其他 reasoning 仍 length > 0。
- `0011` 只以 JSONB 顶层合并修复两个推理键和两款 Kimi 行。
- 不修改 ChatToolbar，因为它已经正确按档位数量动态渲染。

## Pre-Fix Coverage Gap

- malformed fixed `{off:null}` 应返回空档，修复前返回四档。
- fixed current map 遇 pi deepseek `{off:null}` 应保留，修复前被覆盖。
- fixed 零档/多档应被同步闸门拒绝，当前零档因通用默认值通过，多档也仅检查大于零。
- `model-catalog.test.ts` 只检查 baseline 包含 Kimi/fixed，没有验证后续数据迁移覆盖后的最终状态。

## Deferred Candidates

- worker 捕获异常后正常完成会让 pg-boss 错误确认；完整修复需定义可重试/永久失败和 backoff/DLQ。
- `conversations.generating` 无条件清理会在并发 run 中误清；完整修复需统一 runs 事实源和事务化收敛。
- Embedding 配置进程缓存无法跨 worker/多实例失效，且未完整校验 enabled/protocol/model。
- RAG 分批 chunk 插入失败会留下部分数据；应以事务或失败清理独立修复。

这些问题保持为下一轮候选，避免把后台恢复语义或缓存架构混入模型目录数据修复。

## Bug Analysis: fixed 格式与档位 map 所有权漂移

### 1. Root Cause Category
- **Category**:B - Cross-Layer Contract，次要为 D - Test Coverage Gap。
- **Specific Cause**:`resolveThinkingFormat` 把 fixed 视为项目 curated 语义，但 `resolveThinkingLevelMap` 独立采用 pi map；通用档位缺省又把坏 map 解释成四档，导致同步闸门、运行时和 Chat 共同接受混合配置。置信度超过 95%，迁移覆盖链与两个红灯回归均直接复现。

### 2. Why Fixes Failed
1. 既有目录迁移只验证 baseline 含 fixed，没有验证后续迁移后的最终数据，因此 `0001` 覆盖未被发现。
2. 既有 fixed 测试只覆盖完整合法 map，没有覆盖 `{off:null}` 或 current fixed + pi toggle map 的交叉场景。
3. 通用 `getSupportedReasoningLevels` 对缺省基础档位回退为支持，掩盖了目录损坏并让“大于零”闸门失效。

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | fixed 格式与 curated map 在同步时作为同一所有权单元保留 | DONE |
| P0 | Runtime | fixed 只解析显式非空的非 off 字符串档位，不使用通用缺省 | DONE |
| P0 | Test Coverage | 覆盖 malformed、同步交叉场景、零/一/多档与追加迁移 | DONE |
| P0 | Documentation | 在后端七节契约中固化 fixed 与迁移规则 | DONE |

### 4. Systematic Expansion
- **Similar Issues**:后续同步调整 `thinkingFormat` 时，必须同时审视 `thinkingLevelMap` 与 `reasoningEffort` 的所有权，不能逐字段独立决定。
- **Design Improvement**:继续让 `model_catalog` 作为唯一事实源；Chat 和路由只消费统一解析结果，不复制模型名或厂商判断。
- **Process Improvement**:目录数据变更同时验证 baseline、追加迁移最终状态、同步翻译和运行时消费四层，避免单层测试形成假安全感。

### 5. Knowledge Capture
- [x] 更新 `.trellis/spec/backend/chat-generation-params.md` 七节契约。
- [x] 增加运行时、同步不变量和迁移回归测试。
- [x] 使用追加 PostgreSQL 迁移修复存量数据并同步 journal/snapshot。
