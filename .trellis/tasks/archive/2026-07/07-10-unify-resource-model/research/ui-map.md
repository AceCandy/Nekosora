# Research: 后台路径统一 /panel · 废弃 /admin · 模型/服务商/路由 UI 现状

- **Query**: 摸清现状 UI 与路由结构,为「后台路径统一到 /panel、废弃 /admin、模型/服务商/路由管理 UI 改造 + 发布可见性」做前端准备
- **Scope**: internal(只读,rg/Read)
- **Date**: 2026-07-10

---

## 1. 路由结构(admin / panel 完整页面树 + 对照)

### 鉴权机制(关键:不在页面内,在共享 layout)

`src/app/(dash)/layout.tsx` 是 admin + panel **共同**的根 layout(已合并,注释说明原 panel/layout 与 admin/layout 各渲一个 AppShell 会跨段跳转闪动)。分流逻辑:

```ts
// src/app/(dash)/layout.tsx:27-35
const pathname = (await headers()).get("x-pathname") ?? "";  // middleware 注入
const isAdmin = pathname.startsWith("/admin");
const user = isAdmin ? await requireAdmin() : await requireSession();
const groups = isAdmin ? adminNavGroups() : panelNavGroups(user.role);
```

- `x-pathname` 由 `src/middleware.ts:39-40, 58-59` 在 request/response 两处注入 `request.nextUrl.pathname`。
- 因此:**所有 `/admin/*` → `requireAdmin()`;所有非 `/admin`(含 `/panel/*`)→ `requireSession()`**。页面文件自身不写守卫,改路由即改鉴权。
- 段级守卫说明(layout 注释 19-21):此 layout 是 dynamic server component,导航时会重新执行读 headers,守卫始终生效。
- AppShell 的 `matchMode`:`admin → "prefix"`、`panel → "exact"`(影响侧栏高亮匹配)。

### 侧栏导航配置

`src/shared/nav-config.ts`:
- `myConfigGroup`(sectionMyConfig):`/panel/keys` `/panel/providers` `/panel/models` `/panel/templates` `/panel/cards` `/panel/memory` `/panel/knowledge` `/panel/usage`
- `globalManagementGroup`(sectionGlobalManagement):`/admin/providers` `/admin/models` `/admin/templates` `/admin/output-modes` `/admin/render-styles` `/admin/users` `/admin/usage` `/admin/operations` `/admin/settings`
- `panelNavGroups(role)`:admin → [myConfig, globalManagement];普通用户 → [myConfig]
- `adminNavGroups()`:固定 [myConfig, globalManagement]

### 页面树对照表

| admin 页面 | panel 页面 | 作用 / 引用组件 | 数据来源(actions) |
|---|---|---|---|
| `/admin` `admin/page.tsx` | `/panel` `panel/page.tsx`(redirect → `/panel/keys`) | admin: 概览仪表盘(stats + quickLinks);panel: 仅 redirect | admin: `listProviders/listModels/listRoutes/listUsers` from `./actions` |
| `/admin/models` | `/panel/models` | **`ModelsManager variant="global"`** vs **`variant="byo"`** | admin: `listModels/listProviders/listRoutes/createModel/...`;panel: `getMyModels/getMyProviders/createMyModel/...` |
| `/admin/providers` | `/panel/providers` | **`ProvidersManager`**(两处用法几乎一致) | admin: `listProviders/createProvider/...`;panel: `getMyProviders/createMyProvider/...` |
| `/admin/templates` | `/panel/templates` | 模板管理(admin 用 DB+requireSession;panel 走 `lib/templates/service`) | 各自 |
| `/admin/usage` | `/panel/usage` | 用量统计(admin 全局;panel 个人)。admin 有大量子组件(UsageDashboard/Charts/LogsTable/ErrorLogs 等) | 各自 |
| `/admin/output-modes` | — | `OutputModesManager`(admin 独有) | requireAdmin |
| `/admin/render-styles` | — | `RenderStylesManager`(admin 独有) | requireAdmin |
| `/admin/users` | — | 用户列表 + toggle 状态(admin 独有) | `listUsers/toggleUserStatus` |
| `/admin/operations` | — | 运维信息(env/metrics)(admin 独有) | requireAdmin |
| `/admin/settings` | — | 设置页(含 `ModelConfigSection`)(admin 独有) | requireAdmin |
| — | `/panel/keys` | `KeysManager`(API 密钥管理 + 子 key 绑定模型) | `getMyKeys/ensureMasterKey/newSubKey/...` |
| — | `/panel/cards` | `CardsManager`(指令卡) | `listMyCards` |
| — | `/panel/memory` | 记忆管理(内联) | `getMemories/...` |
| — | `/panel/knowledge` | 知识库(`KnowledgeDebug`) | requireSession + DB |

**可直接合并的对照点**:`models` ↔ `models`、`providers` ↔ `providers`、`templates` ↔ `templates`、`usage` ↔ `usage`。
**admin 独有**(需保留在某处或迁移):`output-modes`、`render-styles`、`users`、`operations`、`settings`、概览。
**panel 独有**:`keys`、`cards`、`memory`、`knowledge`。

---

## 2. Manager 组件清单 + variant 分流点

### `ModelsManager` — `src/features/models/ModelsManager.tsx`

**有 `variant: "global" | "byo"` 分流。** `isAdmin = variant === "global"`。

| 分流点 | global 专属 | byo 专属 | 共享 |
|---|---|---|---|
| `hasAccessScope` | `= isAdmin` → 表格多一列 accessScope | 无此列 | — |
| `ModelFormDialog initial` | 传 `GlobalModelInitial`(含 accessScope) | 传 `ByoModelInitial`(无 accessScope) | name/displayName/vendor/systemPrompt/description/capabilities |
| 删除警告文案 | `deleteGlobalWarning` | `deleteByoWarning` | — |
| 路由(RouteFormDialog) | 共享同一组件 | 共享同一组件 | createRoute/updateRoute actions 按页不同 |
| 拖动排序 | `reorderAction=reorderModels` | `reorderAction=reorderMyModels` | 逻辑一致(useOptimistic + dnd-kit) |

表格列(可拖动时 +1 拖动手柄列):`外部名 / 显示名 / 厂商 / [accessScope?] / 路由数 / 状态 / 操作`。路由面板展开行用 `RouteListPanel`(含 `ModelSyncChecker` + `RouteTestButton`)。

prop 全集(`ModelsManagerProps`):`variant, models, routes?, providers?, createAction, updateActions, deleteActions, toggleActions, createRouteActions?, updateRouteActions?, deleteRouteActions?, toggleRouteActions?, fetchModelsAction?, testRouteActions?, reorderAction?`。

### `ProvidersManager` — `src/features/providers/ProvidersManager.tsx`

**无 variant 分流,global 与 byo 完全共用同一组件。** 两侧唯一差异在 page 层传入的 server action 与 provider 数据来源。表格列:`name / protocol / baseUrl / keyCount / status / 操作`。

prop 全集(`ProvidersManagerProps`):`providers, protocols, createAction, updateActions, toggleActions, deleteActions, testKeyAction?, healthActions?`。

### `ModelFormDialog` — `src/features/models/ModelFormDialog.tsx`

`variant: "global" | "byo"`。分流点:
- global:`accessScope` select(public/internal,默认 public);`displayName` required。
- byo:无 accessScope;`displayName` 非 required。
- 标题:`addGlobalModel/editGlobalModel` vs `addByoModel/editByoModel`。

### `RouteFormDialog` — `src/features/models/RouteFormDialog.tsx`

**无 variant,global/byo 共用。** 字段:`providerId`(必填 select)、`upstreamModelName`(必填,带 `UpstreamModelPicker` 拉上游)、`priority`、`weight`。注释:priority 小优先(主备故障转移),同 priority 内按 weight 加权随机(负载均衡)。

### 其他组件

- `CapabilitiesEditor.tsx` — 模型能力位编辑,无 variant。
- `ModelSyncChecker.tsx` — 路由同步状态检查。
- `UpstreamModelPicker.tsx` — 拉 provider 上游模型列表。
- `RouteTestButton.tsx` — 路由可用性测试。
- `ProviderHealthButton.tsx` — 全量健康检测按钮。
- `KeyBundleEditor.tsx` — **多 key + weight 编辑器**(见下节)。

---

## 3. 服务商表单字段(ProviderFormDialog)

**结论:已是「多 key + weight」UI,但「轮询策略」不可选(hardcoded round_robin)。**

`ProviderFormDialog`(`src/features/providers/ProviderFormDialog.tsx`)字段:

| 字段 | name | 类型 | 说明 |
|---|---|---|---|
| 名称 | `name` | text, required | |
| 协议 | `protocol` | select(openai/anthropic/gemini/openai-compatible) | 受控;切换时自动填默认 baseUrl |
| 接口地址 | `baseUrl` | text, required | 受控;显示 `modelsUrlPreview`;有「重置默认」 |
| API Key bundle | `keys[].key` + `keys[].weight` | KeyBundleEditor 多行 | 每行:key(password/text 切换) + weight(number) + 逐 key 测试 + reveal + 删除;底部「新增」「全部测试」 |

PROTOCOLS 常量在 `admin/providers/page.tsx:16-21` 与 `panel/providers/page.tsx:16-21` **重复定义**(4 项,完全相同)。

### key 策略落库现状

- **admin**(`admin/actions.ts:46-64` `createProvider`):`keyStrategy: "round_robin"` **硬编码**,UI 无选择。`collectKeys` 收集 `keys[].key`/`keys[].weight`。
- **panel/byo**(`panel/actions.ts:94-125` `createMyProvider`):同样收多 key bundle,**未设 keyStrategy**(byo 表 `user_providers` 无 `key_strategy` 列,见 schema)。

### schema 列差异(已混淆命名,从注释/引用反推)

`src/db/schema/sqlite.ts` 与 `pg.ts`:
- `global_providers`:`api_keys_enc`(AES-GCM 加密的 bundle JSON)、`key_strategy`(default `round_robin`)、`last_healthy_key_count`、`last_total_key_count`、`last_health_checked_at`。
- `user_providers`:`api_key_enc`(注释同样为加密 bundle)、**无 `key_strategy`**、但有 `last_healthy_key_count` 等健康列。
- `global_models` 有 `access_scope`;`user_models` 无。
- `global_routes` 外键 `global_model_id`;`user_routes` 外键 `user_model_id`。

**page.tsx 取列差异**:admin 读 `p.apiKeysEnc`,byo 读 `p.apiKeyEnc`(列名不同,见两处 `revealKeyBundle` 调用)。

---

## 4. chat 侧消费(global + byo 双查询链路)

### `getVisibleModels` — `src/features/chat/actions/conversations.ts:12`

```ts
export async function getVisibleModels() {
  const user = await requireSession();
  const [globals, byos] = await Promise.all([
    db.select().from(globalModels)
      .where(and(eq(accessScope,"public"), eq(enabled,true)))
      .orderBy(sortOrder),
    db.select({model:userModels, providerName:userProviders.name})
      .from(userModels).innerJoin(userProviders, ...)
      .where(and(eq(userId,user.id), eq(enabled,true)))
      .orderBy(asc(sortOrder), asc(createdAt)),
  ]);
  return { globals, byos };
}
```

**当前是双查询 + 前端拼接。合并后应变单查询。**

### 调用点(前段拼接成 `ModelOption[]`)

1. `src/app/chat/page.tsx:11-29`:`[{...byos(source:byo)}, {...globals(source:global)}]`(byo 在前)。
2. `src/app/chat/[id]/page.tsx:21-57`:同上,额外带 `capabilities`。
3. `src/app/image/page.tsx:7-13`:`getImageModels()`(同样 `{globals,byos}` 结构,过滤 `capabilities.imageGeneration`),拼接 `[...globals, ...byos]`(注意 image 页 globals 在前,与 chat 相反)。

### `ModelOption` — `src/features/chat/model/types.ts:53`

```ts
export interface ModelOption {
  name: string;
  displayName?: string;
  capabilities?: ModelCapabilities;
  source?: "global" | "byo";  // 仅 global 在 UI 标记
}
```

### `ChatToolbar` — `src/features/chat/components/ChatToolbar.tsx:122-127`

```ts
options={models.map((m) => ({
  id: m.name, label: m.displayName ?? m.name,
  badge: m.source === "global" ? t("globalLabel") : undefined,
  badgeVariant: m.source === "global" ? "primary" : undefined,
}))}
```

**仅 global 模型显示「全局」小标签;byo 不标记。** `currentCapabilities` 据选中模型决定推理控件露出。

`ChatComposer`(`ChatComposer.tsx:78`)初始化选中:`models[0]?.name`(即 byo 优先,因为 byos 拼在前)。

### 路由解析层(后端)

`src/lib/routing.ts`:`resolveRoutes`(L58)、`resolveRoutesByCapability`(L250)、`listModelsByCapability`(L271,返回 `{name, source:"global"|"byo"}[]`,同样 global+byo 合并)。注释:resolveRoutes 拿到「含全局/BYO、子 key 绑定、加权故障转移」的路由链。这一层也是双源合并,合并后可统一。

---

## 5. i18n 命名空间(messages/zh-CN.json + messages/en.json)

**两份文件结构完全对齐**(同 top keys、同 nav/admin 子 keys)。en: models=109 keys, providers=51 keys。

- **top keys**:`common, nav, chat, panel, admin, errors, models, providers, filePreview, login, artifacts, share, image`
- **`nav`**:单层扁平。关键:`keys/providers/models/templates/cards/memory/operations/users/usage/globalProviders/globalModels/globalTemplates/sectionMyConfig/sectionGlobalManagement/settings/logout/myUsage/image/knowledge/outputModes/renderStyles`(无 `globalKeys` 等前缀区分,global 用 `global*` 前缀)
- **`models`** 命名空间(ModelsManager + ModelFormDialog + RouteFormDialog 共用):
  - 表头:`colExternalName/colDisplayName/colVendor/colAccessScope/colRouteCount/colStatus/colActions/colUpstreamProvider/colUpstreamModelName/colPriority/colWeight`
  - scope:`scopePublic/scopeInternal/scopePublicOption/scopeInternalOption`
  - 表单:`externalModelNameLabel/displayNameLabel/accessScopeLabel/systemPromptLabel/descriptionLabel/capabilitiesLabel`
  - variant 标题:`addGlobalModel/editGlobalModel/addByoModel/editByoModel`
  - 警告:`deleteGlobalWarning/deleteByoWarning`
  - 路由:`addRoute/addRouteTitle/editRoute/priorityWeightExplanation/upstreamProviderLabel/...`
  - 拖动:`dragHandle`
- **`providers`** 命名空间(ProvidersManager + ProviderFormDialog + KeyBundleEditor 共用):
  - 表头:`colName/colProtocol/colBaseUrl/colKeyCount/colStatus/colActions`
  - 表单:`fieldName/fieldNamePlaceholder/fieldProtocol/fieldBaseUrl/fieldApiKey/modelsUrlPreview/resetDefault`
  - key:`keyPlaceholder/weight/addApiKey/testAllKeys/keyHintRequired/keyHintEdit/keyValid/keyInvalid/keyNetworkError/showKey/hideKey/testKeyTitle/deleteKeyTitle`
  - 健康检测 + 删除:`deleteTitle/deleteConfirm/deleteWarning/deleteButton`
- **`panel`**:`title/enterChat/adminConsole/keys/models/providers/templates/memory/cards/knowledge`
- **`admin`**:`overview/users/operations/settings/models/providers/templates/usage/outputModes/renderStyles`(admin.overview 有 statProviders/statModels/statRoutes/statUsers/quickLinks/gatewayHint 等)

---

## 6. 统一时要改的 UI/路由点 汇总清单

> 仅汇总「动哪里」,不含实现建议(实现决策归主 agent)。

### 路由 / 鉴权

1. `src/app/(dash)/layout.tsx:27-38` — 当前以 `pathname.startsWith("/admin")` 二选一(requireAdmin vs requireSession + adminNavGroups vs panelNavGroups + matchMode prefix/exact)。统一到 /panel 后需重写分流依据。
2. `src/shared/nav-config.ts:16-44` — `globalManagementGroup` 全部 href 指向 `/admin/*`;`myConfigGroup` 指 `/panel/*`。需合并/迁移。
3. `src/middleware.ts:39-40, 58-59` — 注入 `x-pathname`(供 layout 分流用)。若分流逻辑改变,此处影响需评估。
4. 所有 admin 页面目录 `src/app/(dash)/admin/*`(9 个页面 + actions + usage 子组件)迁移或废弃。
5. admin 概览页(`admin/page.tsx`)所有 stats href 指向 `/admin/...`、quickLinks 同;`gatewayHint` 文案 link 指向 `/panel/keys`。

### ModelsManager / ModelFormDialog(variant 分流)

6. `ModelsManager.tsx:109-111` — `isAdmin`/`hasAccessScope` 依赖 `variant==="global"`。合并后若模型表统一(带 accessScope / ownerId),分流逻辑需重做。
7. `ModelFormDialog.tsx:51-56, 117-129, 296-315` — global/byo 两套 initial 类型 + accessScope 仅 global 显示 + 标题文案。
8. `ModelsManager.tsx:357` — 删除警告 `deleteGlobalWarning/deleteByoWarning` 二选一。
9. `admin/models/page.tsx` 与 `panel/models/page.tsx` — 双 page.tsx,数据 shape 映射(ModelItem)、action bind、route 外键名(`modelId` vs `userModelId`,见 panel page 注释 L42)。

### ProvidersManager(无 variant,但有列差异)

10. `admin/providers/page.tsx` 与 `panel/providers/page.tsx` — 双 page.tsx;PROTOCOLS 常量**重复定义**;取列 `apiKeysEnc` vs `apiKeyEnc`(L33 vs L34)。
11. `admin/actions.ts:46-64` vs `panel/actions.ts:94-125` — createProvider 设 `keyStrategy:"round_robin"`,byo 不设;若统一多 key + 策略,byo 表需补列 + UI 需加策略选择(当前 `ProviderFormDialog` 无策略字段)。

### chat 消费(双查询 → 单查询)

12. `src/features/chat/actions/conversations.ts:12-29` `getVisibleModels` — global + byo 双查询返回 `{globals,byos}`。合并后应单查询。
13. `src/features/chat/actions/conversations.ts:32-51` `getImageModels` — 同样双查询模式。
14. `src/app/chat/page.tsx:11-29`、`src/app/chat/[id]/page.tsx:21-57`、`src/app/image/page.tsx:7-13` — 三处 `[{...byos},{...globals}]` 前端拼接 + `source` 标记;注意 chat 页 byo 在前、image 页 globals 在前(顺序不一致)。
15. `src/features/chat/components/ChatToolbar.tsx:122-127` — 仅 `source==="global"` 显示 badge;合并后「可见性」语义可能变(accessScope public/internal 替代 global/byo 二分)。
16. `src/lib/routing.ts` `resolveRoutes/resolveRoutesByCapability/listModelsByCapability` — 后端路由解析同样 global+byo 双源合并。

### i18n

17. `nav` 命名空间:`globalProviders/globalModels/globalTemplates` 与 `providers/models/templates` 两套并存;`sectionGlobalManagement` + `sectionMyConfig` 分组文案。
18. `models` 命名空间:`addGlobalModel/editGlobalModel` vs `addByoModel/editByoModel`、`deleteGlobalWarning` vs `deleteByoWarning`、`scopePublic/scopeInternal` —— 合并后需评估保留哪些。
19. `admin.overview` 全套(stats/quickLinks/gatewayHint)若废弃 admin 概览页需处理。
20. `messages/zh-CN.json` 与 `messages/en.json` 需同步改动(两份结构对齐)。

---

## Caveats / Not Found

- **schema 列名已混淆**(`src/db/schema/sqlite.ts`、`pg.ts` 中 `export const n = ...Table` 全部命名 `n`),无法直接列出全部列名;表/列语义从注释、`pg.ts` 注释、`actions.ts` 引用反推。如需精确列清单需读原始 schema 定义(混淆不影响本调研结论)。
- 未深入 `admin/usage/*` 子组件(UsageDashboard/Charts/LogsTable 等)与 `KeysManager`/`CardsManager` 内部,因它们不属本次「模型/服务商/路由」改造核心;若合并涉及 panel/keys 的子 key→模型绑定,需另查 `panel/keys/KeysManager.tsx` + `panel/actions.ts:60-84`(`bindModel`/`getBindings`)。
- `CapabilitiesEditor` 的能力位字段清单未展开(非本次重点);如需见 `src/features/models/CapabilitiesEditor.tsx`。
- 未验证废弃 /admin 后是否有外部链接/邮件/文档硬编码 /admin 路径(非代码可见)。
