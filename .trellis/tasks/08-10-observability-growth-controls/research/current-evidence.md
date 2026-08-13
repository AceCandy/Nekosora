# 当前证据

- 指标定义与无界入口：`packages/observability/src/index.ts:23-45,118-132`；调用方：`packages/core/src/lib/usage.ts:113-125`。
- 已有低基数 Gateway 指标：`packages/observability/src/index.ts:48-97,134-193`；调用链：`packages/core/src/lib/gateway-execution/telemetry.ts:40-98`、`packages/core/src/lib/gateway-governance/lifecycle.ts:23-35,378-407`。
- execution/attempt schema、索引与 cascade：`packages/db/src/schema.ts:1042-1138`。
- execution 写入终态：`packages/core/src/lib/gateway-execution/telemetry.ts:11-88`；状态路径：`packages/core/src/lib/gateway-execution/engine.ts:117-471`。
- 用量与 Operations 查询：`packages/core/src/lib/usage-aggregate.ts:42-121`、`apps/web/src/app/(dash)/panel/usage/page.tsx:62-79`、`apps/web/src/app/(dash)/admin/operations/page.tsx:37-57`。
- Worker scheduler 与多实例边界：`packages/core/src/lib/worker/runtime.ts:80-121,213-230`、`packages/core/src/lib/worker/definitions.ts:20-62`。
- 现有数据库 claim 模式：`packages/core/src/lib/memory/dispatch.ts:12-51`、`packages/core/src/lib/conversation-title/dispatch.ts:12-51`。
- 产品决策：success 保留 30 天，failed/interrupted 保留 90 天，running 不清理；每批 1000；全局每日一次；Operations 改为近 90 天；不增加聚合归档。
