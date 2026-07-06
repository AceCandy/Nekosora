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
- **传 upstreamModelName(测具体模型可用性)** → 极小 `generateText`(`maxOutputTokens:1`),验证 模型 + key + 协议构建 全链路。对应 `testRoute`/`testByoModel`。

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
