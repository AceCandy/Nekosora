# 模型目录维护

本文面向维护者。日常接入模型请使用“服务商管理”和“模型管理”页面，见 [README 使用说明](../README.md#4-接入自己的模型服务)。

## 同步 pi 模型目录

同步前需在 `.env.local` 中配置 `DATABASE_URL`。默认从 pi 拉取数据并仅输出审计报告：

```bash
pnpm sync:pi-models
```

离线审计或生成迁移时，必须显式指定已审查的本地 JSON snapshot。`--write` 会把 planner 接受的已有模型 direct 更新和缺失主流模型新增写入下一条 PostgreSQL migration：

```bash
PI_MODELS_FILE=/path/to/pi-models.json pnpm sync:pi-models
PI_MODELS_FILE=/path/to/pi-models.json pnpm sync:pi-models -- --write
pnpm --filter @nekusora/web exec vitest run src/lib/reasoning.test.ts src/lib/sync-pi-models.test.ts src/lib/sync-pi-models-cli.test.ts src/lib/model-catalog.test.ts
```

人工审查新生成的 `drizzle/pg/*.sql`、source digest、`meta/_journal.json` 和新 snapshot 一致后应用：

```bash
pnpm db:migrate:pg
```

主流家族及官方 Provider 规则集中在 `packages/core/src/lib/mainstream-models.ts`。新增候选默认启用并具备 tools/system prompt；vision、reasoning 和 token 元数据必须在迁移发布前核对官方资料。

同步器不直接应用迁移，也不创建 Provider、模型实例或路由；聚合商、区域/专项变体和模糊匹配不会自动新增。
