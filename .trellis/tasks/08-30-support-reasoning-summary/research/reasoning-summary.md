# reasoning.summary 兼容性证据

## OpenAI Docs

- 官方文档：<https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries>
- 请求字段位于 `reasoning.summary`；文档示例使用 `auto`，并说明不同模型可能支持 `concise` 或 `detailed`。
- 只有客户端显式请求时才应包含推理摘要输出。

## 当前项目

- `packages/core/src/lib/protocols/parsers.ts:283-285` 已允许嵌套字段名，但随后显式拒绝任何 `reasoning.summary`。
- `packages/core/src/lib/stream.ts:507-509` 已为 `openai-responses` route 构造 `providerOptions.openai`，当前只写入 `store: false`。
- `packages/core/src/lib/providers/types.ts:98-116` 的 `IRRequest` 是入口 parser 与 route adapter 之间的共享请求契约。
- `.trellis/spec/backend/gateway-routing.md` 要求无法表达 IR 参数的 route 在触网前拒绝，并允许引擎继续选择其他 route。

## 已安装依赖

- 项目锁定 `@ai-sdk/openai@4.0.16`。
- `openai-responses-language-model-options.ts:285` 已声明 `reasoningSummary` Provider Option。
- `openai-responses-language-model.ts:282-288,474-482` 会把该选项写入 Responses 请求的 `reasoning.summary`。
- 同一实现允许 `reasoningSummary:null` 抑制默认 `detailed`，并允许用内部
  `forceReasoning` 覆盖 SDK 的模型名启发式；项目只在模型目录明确支持推理时启用后者。

## pi 参考实现

- `docs/cankao/pi/packages/ai/src/api/openai-responses.ts:92-98,323-332` 接受并直接写入 `auto | detailed | concise`。
- 未发现对其他供应商值的转换或自动降级。

## 结论

最小实现无需新增依赖或自写 HTTP 转发：在 Responses parser 校验并写入 IR，在 `openai-responses` route 的现有 Provider Options 中加入 `reasoningSummary`；其他 route format 不读取该 IR 字段，继续正常执行。非法值仍保留入口 400。
