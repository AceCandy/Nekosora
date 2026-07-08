# 网关调用日志重构 — 技术设计

> 配套 `prd.md`（需求/验收）。本文只讲技术方案：数据模型、透传链路、TTFT 采样、写入分流、错误分类、前端、迁移、风险。

## 1. 架构总览

物理双表分离「成功用量」与「错误请求」，写入分流在 `logUsage` 内部完成，调用点（stream.ts / gateway route.ts）不感知表结构。

```
streamChat / generateChat  (持有 ctx + usedRoute + firstTokenAt 计时)
  └─ logUsage(...)
       ├─ status=success            → usage_logs   (+TTFT/providerName/routeName/upstreamModel)
       └─ status=failed/interrupted → ops_error_logs (+errorCode/errorMessage/httpStatus/errorPhase/...)
gateway route.ts (chat/images/audio) —— 错误路径补 httpStatus/errorCode 写 ops_error_logs
```

设计原则：日志写入永不阻断主流程（沿用 `logUsage` try/catch 兜底）；可读信息（providerName/routeName）写入时**快照**，provider 改名不影响历史。

## 2. 数据模型

### 2.1 `usage_logs`（收敛为「成功计费」）— 新增列

现存列全部保留（pg.ts:761 / sqlite.ts:717）。新增（均 nullable，兼容历史行）：

| 新列 | 类型 | 说明 |
|---|---|---|
| `firstTokenLatencyMs` | integer null | 首 token 延迟（TTFT） |
| `providerName` | text null | 可读服务商名快照（替代裸 `providerRef` 展示） |
| `routeId` | text null | 命中路由 id 溯源 |
| `routeName` | text null | 组合展示名（见 2.3） |
| `upstreamModel` | text null | 真实上游模型名（区别于对外 `model`） |

`status` 列保留（兼容）；成功表实际只进 `success`。`httpStatus` 不加到本表（成功恒 200，无意义）。

### 2.2 `ops_error_logs`（新表）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | text pk | |
| `requestId` | text | runId，串联一次生成 |
| `source` | text | `chat` / `gateway` |
| `userId` | text null fk→user | |
| `apiKeyId` | text null fk→apiKeys | |
| `keyKind` | text null | master/sub/null |
| `model` | text | 对外模型名 |
| `upstreamModel` | text null | 真实上游模型名 |
| `providerName` | text null | 可读服务商名 |
| `providerRef` | text null | 裸 `<source>:<providerId>`，保留溯源 |
| `routeId` | text null | |
| `routeName` | text null | |
| `requestPath` | text null | 如 `/v1/chat/completions` |
| `stream` | boolean default false | 是否流式 |
| `httpStatus` | integer null | HTTP 状态码（区别于枚举 status） |
| `errorCode` | text | 错误码（routing_error/generation_failed/...） |
| `errorMessage` | text null | 错误信息（脱敏后） |
| `errorPhase` | text | 生命周期阶段（见 §6） |
| `errorType` | text null | 具体类型 |
| `promptTokens` | integer default 0 | 失败前已计 token（可能 0） |
| `completionTokens` | integer default 0 | |
| `latencyMs` | integer null | 端到端耗时 |
| `firstTokenLatencyMs` | integer null | 失败前是否产出首 token |
| `createdAt` | timestamp | |

索引：`(userId)`、`(createdAt)`、`(errorCode)`、`(httpStatus)`、`(providerRef)`、`(source)`。pg + sqlite 双 dialect 同步。

### 2.3 「路由名称」决策

`globalRoutes`/`userRoutes` **无 `name` 列**（pg.ts:175 / 241），仅有 id/modelId/providerId/upstreamModelName/priority/weight。定义：

- `routeName = ${providerName} · ${upstreamModelName}`（如「OpenAI 官方 · gpt-4o」）
- `routeId` 存 route 原始 id 供溯源
- 写入时计算并快照

## 3. 透传链路（路由可读信息 → logUsage）

| 改动点 | 文件:行 | 内容 |
|---|---|---|
| `ResolvedProvider` 增 `name` | providers/types.ts:13 | 新增 `name: string` |
| `ResolvedRoute` 增 `routeId` | providers/types.ts:27 | 新增 `routeId: string` |
| `toResolvedProvider` 注入 name | routing.ts:36 | `name: row.name` |
| `resolveGlobalRoutes` map 填 routeId | routing.ts:117 | `routeId: row.route.id` |
| `resolveByoRoute` map 填 routeId | routing.ts:155 | `routeId: row.route.id` |
| `LogUsageParams` 扩展 | usage.ts:8 | 新增可选 errorMessage/httpStatus/routeId/routeName/providerName/upstreamModel/firstTokenLatencyMs/requestPath/stream/errorPhase/errorType |

`CallContext` 不需改（路由信息从 `usedRoute` 取，已在 stream.ts 持有）。

## 4. TTFT 采样

| 场景 | 方案 |
|---|---|
| 流式 `streamChat` | `streamChat` 定义 `let firstTokenAt: number \| undefined`，传入 `streamWithRoute`（mutable timing 对象）；`streamWithRoute` 在首个 `text-delta`/`reasoning-delta` 时 `if (firstTokenAt === undefined) firstTokenAt = Date.now()`；`finally` 计算 `firstTokenLatencyMs = firstTokenAt ? firstTokenAt - startedAt : null` |
| 非流式 `generateChat` | `firstTokenLatencyMs = null`（`generateText` 一次性返回，无首 token 概念，注释说明） |
| 路由解析失败 / 全路由失败 | `null` |
| 故障转移 | 记最终尝试的计时（全失败则 null） |

`streamWithRoute` 签名新增 timing 参数：`{ firstTokenAt?: number }`（引用传递）。

## 5. 写入分流（`logUsage`）

```
status === "success"            → insert usage_logs   (含 §2.1 新列)
status === "failed"/"interrupted" → insert ops_error_logs (含 §2.2 字段)
```

- 失败不抛错（沿用 try/catch）。
- Prometheus `observeRequest` 埋点不变（仍按 source/model/status/latency/tokens）。
- `providerRef` 仍写入（两表都存，保留裸 ref 溯源）；前端优先展示 `providerName`，缺失时降级。

## 6. 错误分类（R5）

- **errorPhase**（生命周期阶段，枚举）：`routing` / `upstream` / `network` / `internal` / `auth` / `request`
- **errorType**：复用现有 errorCode（`routing_error`/`generation_failed`/`model_not_found`/`model_not_bound`/`no_route`/...）+ 上游错误码
- **粗分类 code**（前端 i18n 文案 key）：`auth` / `service_unavailable` / `upstream` / `internal` / `rate_limit` / `quota` / `invalid_request` / `other`
- 映射集中在 `src/lib/error-classify.ts`（单一来源），前端粗分类文案走 `messages/*.json` 的 `admin.usage.errors.categories.*`

## 7. 前端

### admin 后台 `admin/usage/page.tsx`
- 双 Tab 容器：`usage`（用量明细）/ `errors`（错误请求），query 参数 `?tab=`
- `UsageDashboard` 图表保持（自然只反映成功用量）
- 用量明细表：现有列 + `providerName`/`routeName`/`upstreamModel`/TTFT，加分页 + 筛选（用户/模型/服务商/路由/时间）
- 错误请求表：新组件 `ErrorLogsTable` + 筛选（user/model/provider/route/phase/httpStatus/时间）+ 分页 + `ErrorDetailDrawer`（错误码/信息/阶段/上游/耗时/TTFT）
- 服务商/路由列显示可读名称（`providerName`/`routeName`），历史裸 `providerRef` 降级

### panel 用户端 `panel/usage/page.tsx`
- 双 Tab + 明细表（现状只有图表，需新增明细）
- 错误请求**脱敏视图**（白名单字段）：时间 / 对外 model / 粗分类 / 状态 / httpStatus；**禁止** apiKey / account / upstream endpoint / providerRef / errorMessage 全文（粗分类替代）
- 复用 admin 的 UsageDashboard（按 userId 过滤）

### 查询层
- 新增 `src/lib/repositories/error-log-repository.ts`：`list({ filters, pagination, userId? })` + `getById(id, userId?)`；admin 不传 userId，panel 传 userId 强制隔离
- usage 明细加分页查询（替换写死 `limit(20)`）

### 设计规范（DESIGN.md）
管理侧莫兰迪中性色（高灰度低饱和）；零影子（静止无投影，除 Modal/hover）；禁彩色侧边粗条、禁 Eyebrow 眉标；字号固定 rem。错误状态色用低饱和红/绿 badge（沿用现有 page.tsx 风格）。

## 8. 迁移

- `pg.ts` + `sqlite.ts` 同步改（双 dialect 对齐）
- `pnpm db:generate:pg`（生成迁移 SQL）+ `pnpm db:push:sqlite`
- 历史 `usage_logs` 中 `status=failed/interrupted` 行：**不迁移**（接受历史混存；新数据起干净分离）。可选写一次性迁移脚本，但非必须。

## 9. 兼容与风险

| 风险 | 处理 |
|---|---|
| 历史 `providerRef` 裸 ID 无 providerName | 前端展示降级：providerName 缺失时 fallback 到 providerRef 或「-」 |
| 聚合统计受影响 | 不会——失败不再进 usage_logs，聚合自然只统计成功（usage-aggregate.ts 无需改） |
| 非流式 TTFT 语义 | 明确记 null + 注释，不混淆 |
| 双 dialect 迁移一致性 | pg.ts/sqlite.ts 严格对齐；迁移后 studio 核对 |
| `requestPath`/`stream` 字段缺失 | gateway route.ts 调用 logUsage 时补传；chat 侧 stream.ts 已知 stream=true |
| 错误信息泄露敏感数据 | errorMessage 落库前不入完整请求体/凭证；用户端进一步脱敏 |

## 10. 不在本设计内（见 prd.md Out of Scope）

重试机制 / TTFT 喂调度器 / 成本计费字段 / 合并 chat `messages` 错误模型。
