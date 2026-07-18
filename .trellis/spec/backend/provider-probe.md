# Provider 连通性探测(probe)契约

> 配置期对上游 provider 的 key/baseUrl/协议鉴权做"配完即测"的主动验证。新增协议或改探测策略时按此契约扩展。

---

## Scenario: 探测一个 provider 的 key 是否可用

### 1. Scope / Trigger
- Trigger: 配置/编辑 provider key 时、健康检测(`checkProviderHealth`/`checkMyProviderHealth`)时。验证「key + baseUrl + 协议鉴权头」三件套,避免配错要等真实调用才发现。

### 2. Signatures
- `probeProviderKey({ protocol, baseUrl, apiKey, upstreamModelName?, headers? })`(`src/lib/providers/probe.ts`)——按是否传 `upstreamModelName` 分双路(对齐 AQBot 的 `validate_key` / `test_model` 职责分离)。
- `buildModelsRequest(protocol, base, apiKey, headers)` —— 统一各协议 `/models` 的 URL + 鉴权头,key 连通性探测与 `fetchUpstreamModels` 共用,鉴权头逻辑单一来源。

### 3. Contracts
- **不传 upstreamModelName(验证 key 连通性)** → `GET /models`,按 HTTP status 判定,**不发生成请求**:
  - `401/403` → `auth` 失败(key 无效/无权限)
  - `5xx` → `unknown` 失败(上游异常,不误导成密钥错)
  - 其余(2xx/3xx/400/404)→ 连通。`/models` 端点缺失(404)或格式不规范(400)不阻塞 key 判定(对齐 AQBot: valid key → 200/400, invalid → 401/403)。
- **传 upstreamModelName(测具体模型可用性)** → 先用极小 `generateText`(`maxOutputTokens:1`)测非流式；非流式出现非鉴权、非网络失败时再用 `streamText` 完整消费流复核。任一模式成功即路由可用，结果用 `mode` 标明通过方式并保留 `nonStreamError`。鉴权或网络失败不重复请求。
- 流式兼容性属于 route/provider 组合，不写入模型目录。禁止从模型名推断 stream 支持，也禁止把所有模型强制改为流式测试。

### 4. 为什么验证 key 不发生成请求
聚合中转站(`/models` 列表第一个常是 voice/image 等非 chat 模型)发 chat 会触发计费或 `model_not_found`,把有效 key 误判成无效(实测 zen-ai.top:`/models` 第一个是 `advanced-voice`,发 chat 撞 quota 403)。`/models` 同样走协议鉴权头,401/403 即 key 问题,足以判定连通性且不产生计费、不依赖具体模型。

### 5. anthropic 协议的混搭鉴权兼容
`buildModelsRequest` 的 anthropic case 对 `/models` **同时携带 `x-api-key` 与 `Authorization: Bearer`**:
- 标准 anthropic(api.anthropic.com):认 `x-api-key`,忽略多余 `Authorization`。
- 火山 Ark 等混搭上游:`/models` 仅认 `Bearer`、`/messages` 才认 `x-api-key`(同一 key 两端点鉴权头不一致,实测)。同时携带兼容这类上游。
- 仅影响 `/models` 探测与 `fetchUpstreamModels`;实际对话走 `createAnthropic` 发 `/messages`,不受影响。

### 6. Wrong vs Correct
#### Wrong
- 验证 key 时发 `chat/completions` 并取 `/models` 列表第一个模型(可能是 voice/image)→ 计费/quota/`model_not_found` 误判。
- 把 5xx 或 quota 403 归为 `auth`(误导成密钥错)。
#### Correct
- 验证 key 只看 `/models` status;测模型才发极小生成请求。
- `401/403`→auth,`5xx`→unknown,其余→连通。

### 7. 相关
- `src/lib/providers/probe.ts`(`probeProviderKey` 双路 + `buildModelsRequest` + `fetchUpstreamModels`)是探测的唯一中枢。
- 设计参考 `docs/cankao/AQBot` 的 `validate_key`(GET /models 看鉴权)与 `test_model`(极小生成请求测具体模型)分离。

---

## Scenario: 两级存活检测(网络层 + key 层)

### 1. Scope / Trigger
- Trigger: 列表「存活检测」按钮手动点击(`checkProviderHealth`/`checkMyProviderHealth`)。不自动、不频繁;其余时候回显落库的最近一次结果。
- 目标:用最小耗费测 key 存活--先判供应商 URL 网络是否通,再判每个 key 是否有效。

### 2. Signatures
- `checkProviderHealth(id)` / `checkMyProviderHealth(id)` -- 串行逐 key 调 `probeProviderKey`(不传 model,GET /models),收集 per-key 结果,落库 + 返回 `{ healthy, total, checkedAt, networkOk, keyResults }`。
- `ProviderKeyResult`(`src/db/schema/pg.ts`)-- `{ index, ok, errorKind?, error? }`,用 `index` 标识第几个 key,**不存明文 key**。

### 3. Contracts
- **网络层判定(零额外请求)**: `networkOk = keyResults 中任一 errorKind !== "network"`。能连上服务器即通(含 ok/auth/unknown);全部 network 失败 -> 不通。
  - 复用 key 探测结果推断,不单独发空 key 探测。
  - 无 key provider(如 OVH 免费层):用空 key 探测一次,network 失败即网络不通。
- **key 层判定**: 每 key `GET /models`,按 `errorKind` 分类:
  - `ok`(2xx/3xx/400/404)-> key 有效
  - `auth`(401/403)-> key 无效/无权限
  - `network`(fetch throw)-> URL 不通(同时拉低网络层)
  - `unknown`(5xx)-> 上游异常(网络层仍算通)
- **落库回显**: 写 `last_network_ok` boolean + `last_key_results` jsonb(用 index,不存明文 key)+ 现有 `last_healthy_key_count`/`last_total_key_count`/`last_health_checked_at`。UI 回显落库值,会话级覆盖最新检测结果。
- **UI**: `networkOk=false` 显红「网络不通」;X/Y 徽章 hover 出 per-key 详情(`密钥 #index: 有效/无效/网络异常`,hover 看 error 原文)。文案「存活检测」而非含糊「健康度」。

### 4. Wrong vs Correct
#### Wrong
- 把网络层与 key 层合并成单一「健康度」X/Y(网络不通时仍显示 key 有效数,误导)。
- 网络层单独发空 key 探测(多一次请求,与 key 探测重复)。
- per-key 结果存明文 key(泄露)。
- 自动频繁检测(冲击上游)。
#### Correct
- 两层独立:网络层(任一非 network 即通) + key 层(每 key errorKind)。
- 网络层复用 key 探测结果,零额外请求。
- per-key 用 index 标识;编辑增删 key 后 index 错位,重新检测即刷新(可接受)。
- 手动触发,落库回显。

### 5. 相关
- `src/lib/providers/probe.ts` `probeProviderKey`(`errorKind` 分级是两级判定的基础)。
- `src/db/schema/pg.ts` `providers.lastNetworkOk`/`lastKeyResults` + `ProviderKeyResult`。
- `src/features/providers/ProviderHealthButton.tsx`(网络标记 + per-key 悬浮)。
