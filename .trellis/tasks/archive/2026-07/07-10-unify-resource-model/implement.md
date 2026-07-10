# Implement Plan: 统一资源模型

> 执行步骤。每阶段尾部是验证 gate,过了再进下一阶段。改造点行号见 `design.md` + `research/refs-map.md` + `research/ui-map.md`。

## 阶段 0:Schema + 迁移(破坏性,无历史数据)

- [ ] 0.1 `src/db/schema/sqlite.ts` + `pg.ts`:删除六表 + 旧 `keyModelBindings`;新增 `providers`(**无 visibility**)/ `models`(**有 visibility**)/ `routes` + 新 `keyModelBindings`(字段见 design §2)。删遗留列。
- [ ] 0.2 `pnpm drizzle-kit generate`(sqlite + pg 各一),确认纯 DDL(drop+create),**无 INSERT**。
- [ ] 0.3 `src/lib/infra/db/bootstrap.ts`:`PG_BASELINE_TABLES`(L109-142)更新表名。
- **gate**:`pnpm typecheck`;本地 migrate 跑通,新三表建出。

## 阶段 1:网关路由解析统一(核心,按 source 分流)

- [ ] 1.1 `src/lib/providers/types.ts`:`ResolvedRoute` 的 `globalModelId/userModelId` → 单 `modelId`;`source` 语义改 visibility(design §5.3)。
- [ ] 1.2 `src/lib/repositories/route-repository.ts`:6 方法 → `findEnabledModelById` / `findEnabledModelByNameForOwner(name,userId)` / `findEnabledRoutes(modelId)` / `findEnabledProvider(providerId)` / `findKeyModelBindings(keyId)→{modelIds}`(design §5.1)。`DrizzleRouteRepository` 改读统一表。
- [ ] 1.3 `src/lib/routing.ts`:
  - `resolveRoutes(ctx, modelName)` = **网关路径**:by name + owner-only(`findEnabledModelByNameForOwner`)。删 internal 拒绝分支(L79-81)。
  - 新增 `resolveRoutesById(ctx, modelId)` = **WebChat 路径**:by id + 可见性校验(`public` 或 `owner=ctx.userId`)。
  - `resolveGlobalRoutes`+`resolveByoRoute` → 合并 `resolveModelRoutes(model)`;`toResolvedProvider` 去 keyField。
  - `listModelsByCapability`(L271)单查 models。
- **gate**:新增/更新 routing 单测(mock repo:网关 owner-only 等价 + webchat byId 可见性 public/owner + 子 key 绑定过滤 + public 命中);`pnpm test`。

## 阶段 2:service / actions 合并 + 7 处绕过点

- [ ] 2.1 合并 `panel/actions.ts` 与 `admin/actions.ts` 的 provider/model/route CRUD 为统一一套。权限校验(role+owner+visibility)落每个 action(design §4)。providers 无 public(所有用户建自己的);model 普通用户强制 private、admin 可 public。
- [ ] 2.2 `reorderModels` 事务内 sortOrder 重写带 `where(ownerUserId)`。
- [ ] 2.3 `listModels`/`getMyModels`/`getBindableModels` 按 §3 后台可见性查询。
- [ ] 2.4 改 7 处绕过只读点(design §8)。**注意 `/v1/models` + MCP list_models 是网关语义 → owner-only**(只列自己的模型)。
- **gate**:`pnpm typecheck`;网关/绑定单测跑通。

## 阶段 3:chat 消费(双查询 → 单查询 + byId)

- [ ] 3.1 `getVisibleModels`/`getImageModels`(conversations.ts:12-51)单查 models,where `(public || (private&&owner)) && enabled`,**private 排序在前**。
- [ ] 3.2 **WebChat 传 modelId**:`ModelOption` 选项 id = modelId;三处页面(`chat/page.tsx`、`chat/[id]/page.tsx`、`image/page.tsx`)拼接统一(private 在前、public 带 badge);发消息链路带 modelId → 后端 `resolveRoutesById`。`ModelOption.source` 推导;`ChatToolbar`(L122-127)badge 判定改 `visibility==="public"`。
- **gate**:`pnpm typecheck`;手动 chat/image 选模型(个人在前、public badge、同名两选项可区分)。

## 阶段 4:UI / 路由

- [ ] 4.1 `src/app/(dash)/layout.tsx`:分流保留(`/admin`→requireAdmin;/panel→requireSession)。`nav-config.ts`:资源项(models/providers/templates/usage)归 `myConfigGroup`(admin 可见发布),`globalManagementGroup` 仅留系统管理项。
- [ ] 4.2 `ModelsManager`/`ModelFormDialog`:去 `variant`,`accessScope` 列→`visibility` 列,加 admin「发布到全局」开关,删警告文案二分。
- [ ] 4.3 `ProvidersManager`/`ProviderFormDialog`:列名统一 `apiKeysEnc`,PROTOCOLS 抽共享去重,补 `keyStrategy` 选择器。
- [ ] 4.4 `RouteFormDialog`:外键名 `userModelId`→`modelId`。
- [ ] 4.5 i18n:`messages/{zh-CN,en}.json` 同步(design §11.3)。
- **gate**:`pnpm lint` + `pnpm typecheck`;手动 admin/user 双视角验收(发布、可见性、拖动排序、providers 各自可见)。

## 阶段 5:全量验证 + 收尾

- [ ] 5.1 `scripts/smoke/routing.smoke.ts` 改操作统一表。
- [ ] 5.2 `pnpm lint` + `pnpm typecheck` + `pnpm test` 全绿。
- [ ] 5.3 `/trellis:check` 全范围复核;手动跑通:admin 发布模型→普通用户 chat 可选(public badge)→网关只调自己模型→用量记调用者→子 key 绑定生效。
- [ ] 5.4 沉淀 spec(统一资源模型 + 可见性/权限矩阵 + 网关 source 分流)+ finish-work。

## Review Gates 汇总

| 阶段 | 必过 |
|---|---|
| 0 | typecheck + 本地 migrate 建表 |
| 1 | routing 单测(网关 owner-only + webchat byId 可见性 + 子 key 绑定)+ test |
| 2 | typecheck + 网关/绑定单测 |
| 3 | typecheck + 手动选模型(含同名区分) |
| 4 | lint + typecheck + 双视角手动 |
| 5 | lint + typecheck + test + smoke + trellis-check |

## 风险锚点

- **阶段 1 命脉**:网关解析改完必须先过单测(owner-only 等价、byId 可见性)再往下。
- **阶段 2 的 7 处绕过点**:逐条对照 design §8 打勾;`/v1/models`/MCP 是网关语义别误放 public。
- **子 key 绑定**:`findKeyModelBindings` 返回 `modelIds`,`resolveRoutes` 绑定校验同步改。
- **chat byId 链路**:WebChat 从传 name 改传 modelId,涉及前端选项 id + 发消息 + 后端 resolveRoutesById,别漏环节。
