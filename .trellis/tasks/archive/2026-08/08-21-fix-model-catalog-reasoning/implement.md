# 模型目录推理能力实施计划

1. 补失败测试：目录最终 invariant、原生 API 格式解析、证据不足时清除完整 bundle。
2. 在同步逻辑中补最小格式解析与最终 invariant，复用现有 planner/operation 结构。
3. 拉取当前 `pi.dev/api/models`，只采纳官方直连和明确格式证据，生成审计清单。
4. 生成 PostgreSQL 数据迁移，并同步 Drizzle journal/snapshot。
5. 补迁移最终状态、幂等性和无关能力不变测试。
6. 验证：
   - `pnpm --filter @nekusora/core exec vitest run src/lib/reasoning.test.ts src/lib/sync-pi-models.test.ts src/lib/model-catalog.test.ts`
   - `pnpm --filter @nekusora/web exec vitest run src/lib/sync-pi-models-cli.test.ts`
   - `pnpm --filter @nekusora/core lint && pnpm --filter @nekusora/core typecheck`
   - `pnpm --filter @nekusora/web lint && pnpm --filter @nekusora/web typecheck`

## Review Gate

- 抽查 OpenAI、Anthropic、Google 以及至少三种兼容格式。
- 统计最终缺失 `thinkingFormat` 的 reasoning 模型必须为 0。
- 确认迁移没有新增模型或修改无关字段。
