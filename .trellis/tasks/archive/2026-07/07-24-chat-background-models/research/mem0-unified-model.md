# Mem0 统一模型执行调研

## 结论

Mem0 的 LLM 不需要绑定 Embedding Provider。`mem0ai/oss@3.1.0` 的公开
`MemoryConfig` 将 `embedder` 和 `llm` 分成独立配置。其 `langchain` LLM provider
接受 `config.model` 对象，并仅硬性要求该对象实现 `invoke()`。

因此可以用轻量适配器调用 Nekosora `generateChat({ modelId })`，复用
`resolveRoutesById`、Provider Registry、key 重试、故障转移和用量日志，不需要
Worker 经 HTTP 请求自身 `/v1/chat/completions`。

## 证据

- `node_modules/mem0ai/dist/oss/index.d.ts`：`MemoryConfig.embedder` 与
  `MemoryConfig.llm` 独立；`LLM` 接口定义 `generateResponse/generateChat`。
- `node_modules/mem0ai/dist/oss/index.js`：`LangchainLLM` 构造只检查
  `config.model` 是对象且含 `invoke()`。
- Mem0 additive extraction 会调用
  `llm.generateResponse(messages, { type: "json_object" })`，随后解析 JSON。
- AI SDK 7 导出 `Output.json()`；`generateText({ output: Output.json() })`
  会构造统一 `responseFormat:{type:"json"}` 并校验 JSON。
- Nekosora `/v1/chat/completions` 当前要求 sk 鉴权，并把调用记为
  `source:"gateway"`；内部 HTTP 回环还会增加密钥管理和重复网络成本。

## 约束

- 只使用 Mem0 的公开 `MemoryConfig` 与 `langchain` provider，不 monkey-patch
  `Memory` 内部属性。
- Mem0 model adapter 只选择 public modelId，通过 `resolveRoutesById` 执行。
- Embedding 配置、向量库和 userId metadata 保持不变。
- Worker 是独立进程；模型配置变化必须通过任务执行时重新读取/指纹重建生效，
  不能依赖管理端进程内的 reset 函数。
