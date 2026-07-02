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

## Common Mistakes

- **不要硬编码错误字符串进响应** → 走 `ErrorCode` + i18n,保证前端可按 code 分支。
- **不要让调用方随意设 HTTP status** → status 由 `ERROR_META[code].status` 决定。
- **新增错误码只改了 `ErrorCode` 没补 `ERROR_META`** → 编译/运行会缺映射。
- **新增错误码没补 i18n 文案** → message 退回错误码字符串。
- **在网关直接用 `RoutingError.code` 短码返回** → 必须经 `routingCodeToErrorCode` 映射成点分码。
