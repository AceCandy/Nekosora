# MAGI 项目进化第 17 轮

## Goal

修复 Kimi K2.7 Code / HighSpeed 的固定推理目录被同步迁移覆盖后，Chat 错误显示多个无效推理档位的问题，确保 `model_catalog`、同步脚本、运行时档位解析和数据库存量数据共同遵守“fixed 只有一个不可关闭、不可调节的开启档”契约。

## Background

- `drizzle/pg/0000_baseline.sql:664-665` 为两款 Kimi K2.7 模型配置 `thinkingFormat: "fixed"`，并显式只启用 `high: "default"`。
- `drizzle/pg/0001_sync_pi_models.sql:142-152` 随后把两行覆盖成 `thinkingLevelMap: { "off": null }`，删除了唯一开启档。
- `src/lib/reasoning.ts:18-25` 对缺省的 minimal/low/medium/high 使用通用默认支持语义，因此上述坏数据被解释为四个可用档位，而不是无有效档位。
- `src/features/chat/components/ChatToolbar.tsx:259-264` 根据档位数量判断固定或可调；四档结果会显示滑杆，但 `fixed` 请求翻译不会发送任何强度参数，用户切换没有效果。
- `src/lib/sync-pi-models.ts:297-313` 会保留当前 `fixed` 格式，却仍采用 pi 的 `deepseek` map，下一次目录同步可以再次生成同类坏数据。
- 2026-07-26 从 `https://pi.dev/api/models` 核验：Moonshot Kimi K2.7 为 reasoning 模型、`supportsReasoningEffort=false`、`thinkingLevelMap={off:null}`；这说明它不可关闭且没有独立强度控制，项目既定 `fixed` 语义应继续保留。

## Requirements

- `fixed` 模型的运行时档位必须只依据 `thinkingLevelMap` 中显式非空的非 `off` 项；缺省项不得套用通用四档默认值。
- `fixed` 目录只有恰好一个非 off 档时才满足同步不变量；零档或多档都必须被识别为非法配置。
- pi 同步在当前目录声明 `thinkingFormat: "fixed"` 时必须保留 curated `thinkingLevelMap`，不得用 pi 的开关格式 map 覆盖固定产品语义。
- 新增 PostgreSQL 数据迁移，修复 Kimi K2.7 Code 与 HighSpeed 的存量 capabilities 为唯一 `high: "default"` 开启档；不得改写已发布的 `0000`/`0001` 迁移。
- 新迁移必须同步 Drizzle journal 和 snapshot，符合当前 `0010` 之后的迁移链。
- Chat 对修复后的 Kimi fixed 配置只显示固定开启状态，不显示关闭选项或多档滑杆；运行时不发送伪造的 `reasoning_effort` 或启停参数。
- 回归测试必须覆盖 malformed fixed map、合法 fixed map、同步脚本的 fixed map 保留、不变量检查以及两款 Kimi 的迁移数据。

## Acceptance Criteria

- [x] `thinkingFormat: "fixed"` + `{off:null}` 不再产生 minimal/low/medium/high 四个假档位。
- [x] 合法 fixed map 只返回 `high`，默认和失效档位均夹到 `high`，请求体保持原样。
- [x] fixed map 的零开启档与多开启档均不能通过同步不变量，恰好一档才能通过。
- [x] pi 提供 `deepseek` + `{off:null}` 时，同步逻辑保留当前 fixed 唯一档位，不生成覆盖变化。
- [x] 新增 `0011` PostgreSQL 迁移只修复两款 Kimi 的 `thinkingFormat`/`thinkingLevelMap`，保留其他 capabilities，并同步 journal/snapshot。
- [x] 模型目录测试能在删除 `0011` 修复或退回坏 map 时失败。
- [x] 聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 与 Trellis 校验通过，独立复核无阻塞项。

## Out Of Scope

- 改写 `0000_baseline.sql` 或 `0001_sync_pi_models.sql` 等已发布迁移。
- 把 Kimi K2.7 改成可关闭或可调强度的 `deepseek` 模式，或向上游发送未公开支持的控制参数。
- 更新 Kimi 的价格、上下文窗口、最大输出、别名或其他模型目录行。
- 改造 ChatToolbar UI；正确的动态 UI 已由运行时档位列表驱动。
- 一并修复 worker 重试、`conversations.generating` 并发、Embedding 多进程缓存或 RAG 分批写入事务。

## Risks And Deferred Items

- 新迁移只修复数据库存量数据；未执行迁移的部署仍会保留坏目录，因此生产发布必须运行既有启动迁移流程。
- 运行时会把 malformed fixed map 解析为空档并隐藏推理控件，而不是猜测一个档位；这属于防御性降级，权威修复仍是目录迁移。
- 本轮通过迁移文本、纯函数和目录测试验证，不连接真实 PostgreSQL；真实迁移执行由现有 bootstrap/migrate 门禁承担。
