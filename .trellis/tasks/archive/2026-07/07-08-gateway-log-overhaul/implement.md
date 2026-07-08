# 执行计划 — 网关调用日志重构

> 配套 `prd.md`（需求/验收）+ `design.md`（技术方案）。按 Phase 顺序执行，每 Phase 独立可验证、独立 commit。

## 前置确认（动手前先读，避免踩坑）

- `src/db/schema/sqlite.ts:717` — `usageLogs` 镜像格式（与 pg.ts 对齐方式）
- `src/lib/errors.ts` — 现有 errorCode 体系（errorPhase 映射依据）
- `drizzle/` — 迁移文件命名/格式
- `src/app/v1/chat/completions/route.ts` + `images/generations` + `audio/speech` + `audio/transcriptions` 的 route.ts — 错误处理点、httpStatus 来源、是否已调 logUsage
- `src/lib/repositories/route-repository.ts` — 仓储模式（新 error-log-repository 照搬）
- `src/lib/session.ts` — `requireAdmin` / `requireSession` 签名
- `messages/zh-CN.json` `admin.usage` 段 + `src/shared/nav-config.ts`
- `.trellis/spec/backend/database-guidelines.md`（双 dialect/命名/迁移约束）、`frontend/component-guidelines.md`

## Phase 1 — DB schema（双表 + 新列）

1. `pg.ts`：`usageLogs` 加 §2.1 五列；新增 `opsErrorLogs` 表（§2.2）
2. `sqlite.ts`：严格镜像同步
3. `db/types.ts`：导出 `OpsErrorLog` 等新类型
4. 生成迁移：`pnpm db:generate:pg` + `pnpm db:push:sqlite`
- **verify**：迁移生成无报错；`pnpm db:studio:pg` 看到两表结构正确
- **rollback**：新增列/表，不删旧；迁移可回退

## Phase 2 — 透传链路 + TTFT

1. `providers/types.ts`：`ResolvedProvider +name`、`ResolvedRoute +routeId`
2. `routing.ts`：`toResolvedProvider` 注入 `name: row.name`（:36）；`resolveGlobalRoutes`/`resolveByoRoute` map 填 `routeId: row.route.id`（:117/:155）
3. `stream.ts`：`streamChat`/`generateChat` 加 `firstTokenAt` 采样；`streamWithRoute` 签名加 timing 参数，首个 `text-delta`/`reasoning-delta` 记时
4. `usage.ts`：`LogUsageParams` 扩展（design §3 字段）；`logUsage` 按 `status` 分流两表
- **verify**：`pnpm typecheck` 通过；现有 stream/routing 单测 `pnpm test` 不破

## Phase 3 — 错误捕获补全

1. `stream.ts` 三处 `logUsage`（:87/:151/:287/:354）补传：`errorMessage`/`httpStatus`/`routeId`/`routeName`/`providerName`/`upstreamModel`/`firstTokenLatencyMs`/`requestPath`/`stream`/`errorPhase`
2. gateway route.ts（chat/images/audio）错误路径：补写 `ops_error_logs`（httpStatus/errorCode/errorMessage/requestPath）
3. 新增 `src/lib/error-classify.ts`：`errorPhase` 判定 + 粗分类 code 映射（单一来源）
- **verify**：本地触发一次失败调用（错误 key / 不存在模型），确认 `ops_error_logs` 有完整记录、`usage_logs` 不再收 failed

## Phase 4 — 查询仓储 + 分页

1. `repositories/error-log-repository.ts`：`list({ filters, page, pageSize, userId? })` + `getById(id, userId?)`（panel 强制 userId 隔离）
2. usage 明细加分页查询（替换 `limit(20)`），支持 filters
- **verify**：单元/手工查询返回结构正确；panel 带 userId 过滤生效

## Phase 5 — admin 后台前端

1. `admin/usage/page.tsx`：双 Tab 容器（query `?tab=usage|errors`）
2. `UsageLogsTable`（用量明细，补 providerName/routeName/upstreamModel/TTFT 列 + 分页筛选）
3. `ErrorLogsTable` + `ErrorDetailDrawer`
4. i18n：`admin.usage.errors.*`（列表头/筛选/详情/粗分类文案）
- **verify**：页面渲染、Tab 切换、筛选/分页、详情抽屉；服务商/路由显示可读名；符合 DESIGN.md（莫兰迪/零影子/无彩色粗条）

## Phase 6 — panel 用户端前端

1. `panel/usage/page.tsx`：双 Tab + 明细表（现状无明细，新增）
2. 错误请求**脱敏视图**（白名单：时间/model/粗分类/状态/httpStatus；禁 apiKey/account/upstream endpoint/providerRef/errorMessage 全文）
3. i18n
- **verify**：用户端无敏感字段泄露；按 userId 隔离

## Phase 7 — 质量验证

1. `pnpm check`（lint + typecheck）
2. `pnpm test`；补/更触及契约的单测：`stream.ts`（TTFT 采样/分流）、`error-classify.ts`、`error-log-repository.ts`、routing 透传
3. 手动端到端：
   - 成功调用 → `usage_logs` 有 TTFT/providerName/routeName/upstreamModel
   - 失败调用 → `ops_error_logs` 有 errorCode/errorMessage/httpStatus/errorPhase，可查详情
   - admin + panel 双 Tab 正常；panel 脱敏
   - 用量图表/聚合仍正确（只统计成功）
- **verify**：全绿

## 回滚点

- 每 Phase 独立 commit，可逐 Phase 回退
- schema 仅新增列/表，不破坏旧结构
- `logUsage` 分流逻辑：必要时可临时回退为「全写 usage_logs」（保留旧 status 行为）作为兜底
