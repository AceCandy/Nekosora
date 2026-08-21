# 模型目录推理能力修复设计

## Resolution Pipeline

1. 从 `0000_baseline` 解析现有目录，定位不完整 reasoning bundle。
2. 以官方直连匹配为写入权威，聚合器和别名匹配仅作为参考。
3. 按以下证据顺序解析 `thinkingFormat`：
   - pi 的 `forceAdaptiveThinking` 或合法 `compat.thinkingFormat`；
   - 官方原生 API：OpenAI Responses/Completions、Anthropic Messages、Google Generative AI/Vertex；
   - 无证据则清除 `reasoning`、`thinkingFormat`、`thinkingLevelMap`、`reasoningEffort`。
4. `thinkingLevelMap` 使用 pi 或官方逐模型数据；缺省标准档位走现有格式默认，`xhigh/max` 不默认开放。
5. planner 在生成操作后统一执行完整 bundle invariant，禁止再次写入缺格式状态。

## Data Migration

- 新建下一号 PostgreSQL 迁移，以 canonical model id 为条件执行幂等 JSONB 更新。
- 迁移只修改 reasoning bundle；不覆盖 tools、vision、webSearch 等无关能力。
- 同步生成对应 snapshot 并追加 journal。
- 测试从 baseline 构造初始目录，再应用迁移预期，验证最终 invariant，而不是修改 baseline 掩盖已有数据库升级问题。

## Runtime Compatibility

- 保留现有 `buildReasoningProviderOptions` 与 compatible body 翻译边界。
- 原生协议通过 providerOptions 翻译；OpenAI-compatible 路由通过 `thinkingFormat` 翻译请求体。
- `fixed`、toggle-only、不可关闭模型继续遵循现有夹档规则。

## Rollback

- 迁移前记录受影响模型及旧 reasoning bundle 的确定性清单。
- 如需回滚，以该清单生成反向数据迁移；不修改历史迁移文件。
