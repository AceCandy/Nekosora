# provider 协议:custom 改名与三方探测修复

## Goal

把 provider 协议 `custom` 改名为 `openai-compatible`(代码 + DB + UI 全链路),并修复第三方 OpenAI 兼容上游(SiliconFlow 等)在配置期探测不通过、但实际调用正常的 bug。

## Background

- `custom` 协议语义是「第三方 OpenAI 兼容上游」,走 `@ai-sdk/openai-compatible`,保持 system role。但命名 `custom` 不直观,容易误读为「自定义兜底」。改名 `openai-compatible` 与 npm 包一致,语义清晰。
- 探测 bug:`probeProviderKey` 在不传 `upstreamModelName` 时用占位模型 `gpt-4o-mini` 验证连通性。OpenAI 官方上游成立,但 SiliconFlow/DeepSeek 等第三方上游模型列表里没有 `gpt-4o-mini`,返回 `model_not_found` 导致探测失败 —— 与 key/baseUrl 无关,纯占位模型不在其列表。

## Requirements

### R1:custom → openai-compatible 改名(全链路)

- `ProviderProtocol` 类型、pgEnum 值、registry/probe 的 case、UI 下拉、PROBE_MODEL record key 全部从 `custom` 改为 `openai-compatible`
- UI 下拉 label 改为中文「OpenAI 兼容」
- DB 迁移:
  - pg:`ALTER TYPE provider_protocol RENAME VALUE 'custom' TO 'openai-compatible'`(enum 值改名,所有引用该 enum 的列数据自动传播:global_providers + global_routes)
  - sqlite:text 列无 enum 约束,需 UPDATE 两张表
- 现有 `protocol='custom'` 的 provider/route 记录迁移到 `openai-compatible`

### R2:修复三方接口探测

- `probeProviderKey` 在未传 `upstreamModelName` 时:先 `fetchUpstreamModels` 拉真实模型列表,用第一个真实模型探测;`/models` 失败时降级到占位模型(保持原行为)
- 传 `upstreamModelName` 时保持原行为(直接用该模型)

### 范围排除

- 无关的 `custom` 字面量(memory scope、renderStyle renderer)不动
- `openai-images` / `openai-audio-stt` / `openai-audio-tts` 协议不动

## Acceptance Criteria

- [ ] provider 协议相关位置无 `"custom"` 残留(memory/renderStyle 的 custom 不算)
- [ ] pg 迁移文件含 `RENAME VALUE 'custom' TO 'openai-compatible'`,`pnpm db:generate:pg` 后人工核实正确
- [ ] sqlite 迁移文件含两条 UPDATE(global_providers + global_routes),journal 已注册
- [ ] admin 下拉显示「OpenAI 兼容」,值为 `openai-compatible`
- [ ] `pnpm typecheck` 0 错;`pnpm test` 全过
- [ ] 探测逻辑:未传模型名时先拉 /models,失败降级占位

## Open Questions

- 无(方案已定:彻底改 enum 值 `openai-compatible`,含 DB 迁移)
