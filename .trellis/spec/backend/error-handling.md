# Error Handling

> Nekusora 服务端错误处理约定。权威实现:`src/lib/errors.ts`。

---

## Overview

全站统一 API 错误契约:错误码(机读、点分命名空间、永不改字符串)+ OpenAI 风格 type + i18n 文案。HTTP status 由错误码决定,调用方不随意设置,保证一致性。

---

## API Error Responses(契约)

所有 `/v1/*` 网关与 `/api/*` 路由返回错误时,body 必须是此结构:

```ts
{
  error: {
    code:    string,   // 稳定的机读错误码(点分命名空间),如 "auth.invalid_key"
    message: string,   // 人类可读信息(按 Accept-Language 渲染)
    type:    string,   // OpenAI 风格类型,便于 SDK 分类
    details?: unknown  // 可选额外上下文(字段级错误、上游响应等)
  }
}
```

### 工具函数(`lib/errors.ts`)

| 函数 | 用途 | 返回 |
|------|------|------|
| `errorResponse(code, details?, messageOverride?)` | 构造 body(不包 NextResponse) | `ErrorResponseBody`,供 SSE 帧等自定义包装 |
| `apiError(code, details?, messageOverride?)` | 单 JSON 错误响应(默认中文) | `NextResponse.json(body, { status })` |
| `apiErrorLocalized(code, req, details?)` | 按 `Accept-Language` 渲染文案 | `NextResponse.json(body, { status })`,网关优先用 |

**选择规则**:
- `/v1/*`(对外、面向全球开发者)→ `apiErrorLocalized(code, req)`。
- `/api/*`(内部、默认中文足够)→ `apiError(code)`。
- SSE 流式错误帧 → `errorResponse(code)` 拼进 `data:` 帧。

---

## Error Types

- **错误码**:`ErrorCode` 枚举(点分命名空间),新增错误在此登记,保证唯一。`ErrorCodeValue` 是其联合类型。
  - 命名空间:`auth.*` / `routing.*` / `request.*` / `server.*` …
- **OpenAI 风格 type**(`ErrorType`):`invalid_request_error` / `authentication_error` / `permission_denied_error` / `not_found_error` / `rate_limit_error` / `server_error`。
- **错误码 → type + status 映射**:集中在 `ERROR_META: Record<ErrorCodeValue, ErrorMeta>`,新增码必须同时登记 meta。
- **请求体过大**:`request.payload_too_large` 固定映射 HTTP 413 + `invalid_request_error`;`/v1/*` 用 `apiErrorLocalized`,内部 `/api/*` 用 `apiError`。
- **RoutingError 历史短码**:`routing.ts` 抛 `RoutingError`(短码如 `model_not_found`),经 `routingCodeToErrorCode()` 映射到点分码,不要在网关层直接用短码。

---

## Error Handling Patterns

**入口校验顺序**(网关 route 标杆,见 `app/v1/chat/completions/route.ts`):

1. 鉴权:`extractBearer(header)` → `verifyKey(rawKey)` → 失败返 `AUTH_MISSING_KEY` / `AUTH_INVALID_KEY`。
2. 解析 body:`try { body = await req.json() } catch { REQUEST_INVALID_JSON }`。
3. 业务逻辑抛错 → 用 `routingCodeToErrorCode` 等映射后 `apiErrorLocalized`。

**message 文案优先级**:`messageOverride`(调用方)> i18n 字典(按 locale)> 错误码字符串。`errorResponse` 在无 override 时 fallback 到 `resolveDefaultMessage(code)`(默认 zh-CN)。

---

## i18n

- 文案字典在 `lib/i18n/errors.zh-CN.ts` / `errors.en.ts`,`SUPPORTED_LOCALES = ["zh-cn", "en"]`,`DEFAULT_LOCALE = "zh-cn"`。
- `translateError(code, locale)` 按 locale 查字典,缺失 fallback 到 zh-CN。
- UI 文案国际化(非错误响应)另接 next-intl,不走此字典。

---

## 生成失败错误归类(`stream.ts`)

stream 生成失败时,从 AI SDK 错误提取**真实上游 statusCode** 归类落库,不再笼统记 `generation_failed`/502(否则 429 限流、5xx、网络错误在后台都显示 502,丢失真实状态码)。

### 提取与映射(`classifyStreamError`)
- AI SDK `RetryError`(`maxRetriesExceeded`)的真实错误在 `lastError`(`AI_APICallError` 带 `statusCode`);直接抛出的 `AI_APICallError` 自带 `statusCode`。duck-typing 提取(`err.lastError?.statusCode ?? err.statusCode`),不依赖错误类 import。
- 按真实 statusCode 映射短码(与 `error-classify.ts` `ERROR_CODE_MAP` 对齐,四条细码已收录):
  - `429` -> `rate_limited`(phase=request, category=rate_limit)
  - `401/403` -> `auth_error`(phase=auth)
  - `5xx` -> `upstream_error`(phase=upstream)
  - 无 statusCode + 命中网络关键字(`NETWORK_KEYWORDS`) -> `network_error`(phase=network)
  - 其余(400/404 等 4xx 或未知)-> `generation_failed`(兜底,phase=upstream)
- 落库(`ops_error_logs`):`httpStatus` 用真实 statusCode(无则 `SHORT_HTTP_STATUS[errorCode]`);`errorPhase` 经 `classifyError({ errorCode, httpStatus, errorMessage })` 三参同传,429 归 `rate_limit` 而非 `upstream`。`errorMessage` 保留 `lastError.message`(含 "Too Many Requests" 等原文)。

### 重试策略
- `streamText`/`generateText` 显式 `maxRetries: 0`,**禁用 AI SDK 自动重试**(默认 2 次 = 3 次尝试)。
  - 理由:AI SDK 对 429(`isRetryable`)无脑重试放大 TPM 消耗(不尊重 `retry-after`,每次重发 messages 重复计费),5xx 重试加重上游压力;且 V5 `maxRetries` 是全局数字,不支持"只对 429 不重试"。
  - 故障转移由 `stream.ts` 接管:多 key(`isKeyAuthError` 换 key)+ 多路由(`isFailoverableError` 转移)+ 熔断器。
  - 代价:单路由单 key 的临时网络抖动/5xx 不再自动重试(靠多路由转移或手动重试,熔断器仍记录)。

### 不变
- 发给前端的 `error` 帧 `code` 保持粗码 `generation_failed`(前端契约不变);只落库用细码。
- `isFailoverableError`:429 仍判可转移(换不同 provider 路由有用;换同 provider key 由 `isKeyAuthError` 挡住)。

## Scenario: Gateway SSE Cancellation

### 1. Scope / Trigger

Apply this contract when changing `/v1/chat/completions` streaming, `ReadableStream` ownership, gateway user-agent loading, or `streamChat` abort propagation.

### 2. Signatures

- `POST(req: NextRequest): Promise<Response>`
- `streamResponse(...): Response`
- `streamChat({ abortSignal, ... }): AsyncGenerator<StreamEvent>`

### 3. Contracts

- The response stream owns one `AbortController`; `ReadableStream.cancel()` aborts it.
- Pass the same signal to `streamChat` so the AI SDK can cancel the upstream request and Agent routing stops failover.
- If cancellation occurs while gateway setup is awaiting, do not start `streamChat` after that await returns.
- After cancellation, do not enqueue data, `[DONE]`, or an error frame, and do not close the already-cancelled controller.
- Normal completion still emits `[DONE]`; non-cancellation failures still emit one SSE `server_error` frame.

### 4. Validation & Error Matrix

| Condition | Upstream action | Response action |
| --- | --- | --- |
| Normal finish | Complete normally | Emit final chunks, `[DONE]`, close |
| Generation throws | Stop iteration | Emit `server_error`, close |
| Consumer cancels during generation | Abort signal | Emit nothing else; do not close again |
| Consumer cancels while gateway UA loads | Do not start `streamChat` | Emit nothing else; do not close again |

### 5. Good / Base / Bad Cases

- Good: cancelling the body marks the exact signal passed to `streamChat` as aborted and causes zero later controller writes.
- Base: a completed stream retains OpenAI-compatible chunks and `[DONE]`.
- Bad: abort only a local flag while upstream generation continues, then enqueue `[DONE]` into a closed controller and turn that failure into another error-frame write.

### 6. Tests Required

- Exercise cancellation through exported `POST`, not by exporting `streamResponse` for tests.
- Assert the signal received by `streamChat` is aborted.
- Observe the Web Streams controller boundary and assert no `enqueue` or `close` occurs after cancellation.
- Cover cancellation during an awaited gateway setup step and assert `streamChat` is not invoked.
- Keep normal completion and ordinary exception SSE characterization tests.

### 7. Wrong vs Correct

```typescript
// Wrong: cancellation does not reach upstream, and terminal writes race a closed stream.
for await (const event of streamChat({ ctx, request })) consume(event);
controller.enqueue(doneFrame);

// Correct: share the signal and suppress all terminal writes after cancellation.
for await (const event of streamChat({ ctx, request, abortSignal })) consume(event);
if (!abortSignal.aborted) controller.enqueue(doneFrame);
```

---

## Common Mistakes

- **不要硬编码错误字符串进响应** → 走 `ErrorCode` + i18n,保证前端可按 code 分支。
- **不要让调用方随意设 HTTP status** → status 由 `ERROR_META[code].status` 决定。
- **新增错误码只改了 `ErrorCode` 没补 `ERROR_META`** → 编译/运行会缺映射。
- **新增错误码没补 i18n 文案** → message 退回错误码字符串。
- **在网关直接用 `RoutingError.code` 短码返回** → 必须经 `routingCodeToErrorCode` 映射成点分码。
