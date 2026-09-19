# 模型目录维护

本文面向维护者。日常接入模型请使用“服务商管理”和“模型管理”页面，见 [README 使用说明](../README.md#4-接入自己的模型服务)。

## 手动标记图像生成能力

管理员在模型管理中新增或编辑模型，选择模板后打开“模板预览”，选择“出图方式”：关闭、Images 图片接口或 Responses 绘图工具。设置立即保存到 `model_catalog.capabilities.imageGeneration` 和 `imageGenerationFormat`，对所有引用该模板的模型生效；关闭模型编辑弹窗不会撤销该设置。普通用户只能查看能力。关闭保留此前配置的格式。

聊天与绘图双能力模型保留 `modelType: "chat"`。绘图入口按 `imageGeneration` 筛选，pi 同步仅更新其负责的能力属性，保留手动开启或关闭的图像生成标记。

`imageGenerationFormat` 缺省为 `openai-images`，旧记录无需迁移；pi 同步保留手动标记及出图方式。

- Images：调用上游图片接口，路由中的上游模型名须是该接口支持的图片模型。
- Responses：调用上游 `/responses` 并强制使用 `image_generation` 工具，路由中的上游模型名是支持该工具的聊天模型。Provider 必须为 `openai` 或 `openai-compatible`，目录 `tools` 和路由“工具调用”均需开启；不影响聊天接口格式。工具内的图片模型使用上游默认值。

Responses 当前每次仅生成一张 PNG，支持 `1024x1024`、`1024x1536`、`1536x1024`；多图请求直接拒绝，不自动拆成多次收费请求。记录实际图片张数和 token 用量，图片配额仍按张数结算。设置只选择调用方式，不能让不支持绘图工具的上游获得该能力。暂不包含聊天内绘图、图片编辑或其他原生出图协议。

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
