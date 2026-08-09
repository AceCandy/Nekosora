# 多协议双向网关实施计划

## 成功条件

完成后必须同时满足 PRD AC1-AC12。任何阶段若需要静默忽略参数、绕过 `executeGateway` 或在 route 之外维护第二份模型能力表，应停止并修正设计，而不是继续堆兼容分支。

## 1. 建立测试骨架与共享类型

- [ ] 为 `RouteApiFormat`、CanonicalRequest、CanonicalEvent、结构化 unsupported-parameter 错误先写类型和最小测试。
- [ ] 先建立 chat/media operation registry 的 selected/rejected 类型骨架，后续 schema 切换不得出现运行时仍只认 Provider protocol 的中间提交。
- [ ] 为四种 parser/encoder 建 fixture 目录，只收录首期公共语义和明确拒绝项。
- [ ] 确认现有 `IRRequest`/`StreamEvent` 的所有调用方，决定原位演进或提供一次性兼容转换；不得长期保留两个 IR。

验证：

```bash
pnpm --filter @nekusora/core test -- src/lib/providers
pnpm --filter @nekusora/core typecheck
```

回滚点：此阶段只新增类型与失败测试，不改变运行时。

## 2. 数据库与 route 写入链

- [ ] 在 `packages/db/src/schema.ts` 和共享 types 中增加 `route_api_format` / `RouteApiFormat`。
- [ ] 生成下一条 PostgreSQL migration，并手工核对按 Provider protocol 回填的 SQL、`NOT NULL` 顺序和媒体格式映射。
- [ ] 同步 Drizzle journal/snapshot，不编辑历史 migration。
- [ ] 修改 admin/panel 的 create、attach、update actions；新增值显式写入，省略更新保持原值。
- [ ] 修改 route repository、routing 与 `ResolvedRoute`，普通聊天只从 route 读取上游格式。
- [ ] 明确 Image/STT/TTS 继续走 operation 专属 media registry；chat/media registry 相互拒绝错误格式。
- [ ] 补 migration、action、repository、routing 测试，以及三个媒体格式的解析和首 key/route 故障转移回归。

验证：

```bash
pnpm --filter @nekusora/web test -- src/app/\(dash\)/admin/actions.test.ts src/app/\(dash\)/panel/actions.test.ts
pnpm --filter @nekusora/core test -- src/lib/routing.test.ts
pnpm --filter @nekusora/db typecheck
```

回滚点：新列不删除 Provider protocol；该阶段与 registry/runtime 切换不可拆分部署。尚未写入新格式时可在暂停 route 写入后同时回滚应用与数据库。

## 3. Ingress parser 与错误边界

- [ ] 实现共享鉴权提取，支持原生头/Bearer、冲突拒绝和 Gemini query Key 拒绝。
- [ ] 实现 Chat、Responses、Messages、Gemini parser，统一生成 CanonicalRequest。
- [ ] 使用显式 allowlist 校验顶层与嵌套参数；所有不支持项返回带准确路径的 `UnsupportedParameterError`。
- [ ] 登记 `request.unsupported_parameter` 到 `ErrorCode`、`ERROR_META`、中英文错误字典和 routing/gateway 映射；status 只从 `ERROR_META` 获取。
- [ ] 为 Responses 状态字段、工具类型、音频、文件、logprobs、多候选、缓存字段和数值推理预算补“无上游调用”测试。

验证：

```bash
pnpm --filter @nekusora/core test -- src/lib/protocols
```

回滚点：parser 尚未接入公开路由，不影响现有客户端。

## 4. Route 级上游 adapter

- [ ] 将 `buildLanguageModelWithKey` 改为按 route `apiFormat` 选择 Chat、Responses、Messages 或 Gemini SDK model。
- [ ] 保留 OpenAI 官方与 compatible Chat 的现有差异；其他格式只由 route 决定。
- [ ] 合并 Provider/route headers，并确保 adapter 原生鉴权头最终覆盖自定义认证头。
- [ ] 将 JSON Schema、tools/tool choice、图片和目录推理档位从 CanonicalRequest 传给 AI SDK。
- [ ] 所有 AI SDK 调用继续 `maxRetries:0`。
- [ ] route 无法表达参数时返回 rejected attempt；全链不兼容时收敛为确定性 400，不更新 breaker。
- [ ] engine 记录 rejected attempt 的 request phase、安全 route snapshot 和统一错误码；测试无网络、无 Key 轮换、无 breaker 更新及 final aggregation 顺序。
- [ ] chat registry 拒绝媒体格式，media registry 拒绝 chat 格式；媒体行为保持现有 adapter 与 failover 契约。

验证：

```bash
pnpm --filter @nekusora/core test -- src/lib/providers/registry.test.ts src/lib/gateway-execution
```

回滚点：保留原 Chat factory 测试，任何现有 Chat 请求体差异都必须先修复。

## 5. 统一流事件与 encoder

- [ ] 从 AI SDK full stream 产生文本、推理、工具开始/增量/结束、usage、finish 和 error 事件。
- [ ] 更新提交状态：所有文本、推理和工具事件 yield 前均不可撤回。
- [ ] 实现一个非流式 collector。
- [ ] 实现 Chat、Responses、Anthropic、Gemini 四种非流式/流式 encoder 与原生错误 envelope。
- [ ] encoder 从已解析的 ErrorCode/ErrorMeta 取得 status/type/message；只在 Anthropic/Gemini 边界改变 body 形状。
- [ ] 未知 finish reason 按错误终止，不伪造 `stop`；未知 usage 细分省略，不填 0。
- [ ] 覆盖自然 finish、error、setup cancel、生成 cancel 和无响应 iterator；断言 cleanup、usage、telemetry finally 恰好一次。

验证：

```bash
pnpm --filter @nekusora/core test -- src/lib/stream src/lib/protocols
```

回滚点：先保持现有 Chat encoder 契约测试通过，再开放新增 encoder。

## 6. HTTP 路由、取消与代理

- [ ] 更新 `packages/contracts/src/routes.ts`，使用 `:model::generateContent` / `:model::streamGenerateContent` 注册 Gemini 路径。
- [ ] 在 core HTTP index 和 gateway handlers 注册 Responses、Messages、Gemini handler。
- [ ] Web 代理继续从共享 `GATEWAY_ROUTES` 获取路径，不复制列表。
- [ ] 四种协议、五个 HTTP 路径都把 `req.signal` 和 response stream cancel 传到统一执行链；非流式同样可取消。
- [ ] 修复现有 Chat handler 的 signal 断链，并补回归测试。
- [ ] 取消后断言不再写 chunk、error、协议终止标记、`[DONE]` 或 close；provider iterator 不响应 Abort 时 handler 也能结束。

验证：

```bash
pnpm --filter @nekusora/gateway test -- src/server.test.ts src/server.listener.test.ts
pnpm --filter @nekusora/core test -- src/http/v1
```

回滚点：新路由可独立移除；现有 Chat 路由和 handler 名称不变。

## 7. Base URL、探测与管理界面

- [ ] Provider 服务端校验拒绝具体生成 endpoint 后缀，保留 API 根地址语义。
- [ ] Route 可用性探测按 `apiFormat` 使用共享 adapter；Provider `/models` 探测保持 Provider protocol 语义。
- [ ] RouteFormDialog 增加上游 API 格式 select，Provider option 携带 protocol 以提供兼容默认值。
- [ ] admin/panel 页面回显 `apiFormat`，补中英文 i18n；不增加 route 级 URL override。
- [ ] UI endpoint 预览只作为说明，服务端仍执行全部校验。

验证：

```bash
pnpm --filter @nekusora/web test -- src/app/\(dash\)/admin/actions.test.ts src/app/\(dash\)/panel/actions.test.ts
pnpm --filter @nekusora/web typecheck
```

回滚点：隐藏 select 不得改变已存 route；服务端 action 仍能读取旧表单。

## 8. 16 组合集成矩阵

- [ ] 创建测试内 fake upstream，分别实现四种格式的 JSON/SSE 响应，不启动常驻服务。
- [ ] 对 4 ingress x 4 egress 逐项断言 endpoint、原生鉴权头、请求体和入口响应协议。
- [ ] 在矩阵中覆盖文本基线；对图片、tools/results、JSON Schema、reasoning、finish、usage 使用参数化能力用例。
- [ ] 依据 design 能力矩阵断言每个扩展语义是成功映射或 pre-upstream 400；不得强求所有扩展语义在 16 组合中都成功。
- [ ] 覆盖首 route 不兼容后切换、Key 失败后轮换、提交前故障转移、提交后禁止切换。
- [ ] 覆盖 Base URL 尾斜杠、`.../v1`、Gemini `.../v1beta`、两个 Gemini endpoint、`alt=sse` query 和 endpoint-style Base URL 拒绝。

验证：

```bash
pnpm --filter @nekusora/core test -- src/lib/protocols/multi-protocol-matrix.test.ts
```

## 9. 独立复核与质量门禁

- [ ] 按 `.trellis/spec/backend/gateway-routing.md` 复核 engine 所有权、提交边界、breaker 和 telemetry 顺序。
- [ ] 按 cross-layer guide 从 DB -> action -> repository -> runtime -> adapter -> encoder -> UI 逐字段追踪 `apiFormat`。
- [ ] 搜索并移除本任务造成的旧 `route.protocol` wire-format 读取和未使用代码；不清理无关代码。
- [ ] 检查日志、fixtures、错误快照中没有真实 Key、完整认证头或含 `?key=` 的 URL。
- [ ] 运行定向测试、类型检查、lint；最后再运行受影响 package 的完整测试，不默认启动开发服务。

验证：

```bash
pnpm --filter @nekusora/core test
pnpm --filter @nekusora/gateway test
pnpm --filter @nekusora/web test
pnpm --filter @nekusora/db typecheck
pnpm --filter @nekusora/core typecheck
pnpm --filter @nekusora/gateway typecheck
pnpm --filter @nekusora/web typecheck
pnpm --filter @nekusora/gateway lint
pnpm --filter @nekusora/web lint
```

未在没有明确需要时运行全仓 build，也不连接真实厂商 API。若实现期为调试启动服务，结束前必须关闭。

## 10. 发布前检查

- [ ] 在全新数据库和含存量 route 的数据库副本各验证一次 migration。
- [ ] 确认旧 `/v1/chat/completions` 客户端契约未变。
- [ ] 确认管理界面创建的新 route 总有 `apiFormat`，旧表单更新不会清空该值。
- [ ] 确认 rollback 前置条件：不存在旧代码无法表达的新格式 route，或已先迁回兼容格式。
- [ ] 更新 `.trellis/spec/backend/gateway-routing.md`，把 route API format、协议转换和 400 规则固化为后续契约。
- [ ] 更新 `.trellis/spec/backend/error-handling.md`，记录原生协议错误 envelope 例外仍复用 ErrorCode/ErrorMeta/i18n 的契约。
