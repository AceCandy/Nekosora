# Gateway 请求入口与生命周期调研

## 已确认事实

- `packages/contracts/src/routes.ts:1` 是 Gateway 路由矩阵唯一事实源。公网模型调用包括 OpenAI、Responses、Anthropic、Gemini、Image、TTS 和 STT；另有模型列表与 MCP 入口。
- `apps/gateway/src/server.ts:213` 为每个请求创建 `AbortController`，在原始请求中断或响应连接提前关闭时中止 Core `Request.signal`。
- 四种文本协议统一进入 `packages/core/src/lib/protocols/handler.ts:17`。鉴权成功后解析请求，再分流到流式或非流式 encoder，这是文本协议最窄的治理接入点。
- `packages/core/src/lib/protocols/encoders.ts:386` 的流式响应把源 signal 传给内部 controller；`cancel()` 会中止上游，`finally` 会移除 listener。租约必须覆盖到流结束、取消或异常终态，不能在返回 `Response` 时提前释放。
- Image、TTS、STT 各自在 HTTP handler 中调用 `verifyKey`，再进入 `executeAtomicGateway`。适配器已接受 engine 的 `abortSignal`，但 HTTP `request.signal` 当前没有传入媒体执行链。
- `/v1/models` 只查询数据库，不调用 Provider；`POST /v1/mcp` 只执行模型列表或 RAG 检索。它们应进入请求速率边界，但不进入 Provider 用量配额。
- `GET /v1/mcp` 固定返回 405，不需要创建治理状态。

## 规划结论

- 速率检查应在鉴权成功后、解析大请求体或调用 Provider/RAG 前执行。
- 文本流需要用包装后的 `Response.body` 或等价生命周期钩子持有并发租约，直到完成、取消或中断。
- 媒体接线必须同时补齐 HTTP signal 传播，否则客户端断开后上游仍可能运行，租约也只能等待过期回收。
- Gemini `/v1beta/models/*` 与其他公开模型入口采用同一治理规则，不能因路径不以 `/v1/` 开头而遗漏。

## 验证重点

- 每个受保护入口在拒绝后都不得解析大 body、查询路由或调用 Provider。
- 正常完成、入口异常、Provider 异常、客户端取消与连接关闭均只释放一次租约。
- 流式响应返回后租约仍存在；body 完成或取消后立即释放。
- 媒体请求取消会中止传给 AI SDK 的同一 signal。
