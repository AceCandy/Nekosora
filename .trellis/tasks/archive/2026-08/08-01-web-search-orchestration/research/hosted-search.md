# Hosted Search 能力与版本事实

## 项目锁定依赖

- `ai 7.0.31`
- `@ai-sdk/openai 4.0.16`
- `@ai-sdk/anthropic 4.0.16`
- `@ai-sdk/google 4.0.18`
- `@ai-sdk/openai-compatible 3.0.12`

已安装类型声明确认：

- OpenAI：`openai.tools.webSearch()` / `webSearchPreview()`，属于 provider-executed tool。
- Anthropic：`anthropic.tools.webSearch_20250305()` / `webSearch_20260209()`。
- Google：`google.tools.googleSearch()`，grounding metadata 包含 queries/chunks/supports。
- 当前项目未安装 xAI SDK，现有 OpenAI-compatible Chat Completions 不能等同于 xAI Hosted Search。

## xAI 可行性

规划时 npm registry 最新 `@ai-sdk/xai` 为 `4.0.25`；发布的类型声明包含：

- `xai.tools.webSearch()`，返回 query 与 sources。
- `xai.tools.xSearch()`，本任务不使用。
- Responses 模型与 server-side agentic tools。

实施时应锁定经过兼容性与依赖审查的具体版本，并以 lockfile 与实际 `.d.ts` 为准。

## OpenAI 官方语义

OpenAI 官方 Web Search 指南明确：

- 新集成推荐 Responses API 的 `{type:"web_search"}`。
- 作为 Responses tool 时，模型可根据输入决定是否搜索。
- Chat Completions 的专用 search model 会在回答前始终搜索，不适合本任务的“按需”目标。
- 输出包含 `web_search_call`、message URL annotations/citations；面向用户展示时引用应清晰可见且可点击。

来源：`https://developers.openai.com/api/docs/guides/tools-web-search.md`，于 2026-08-01 读取。官方 Docs MCP 已注册，但当前会话需重启后才能加载，故本轮按技能规则使用官方域名 Markdown 回退。

## 设计结论

- Hosted Search 必须由独立 translator 生成 SDK provider tool，不能塞进现有 OpenAI function IR 后假装本地工具。
- 主模型仍只看逻辑 `web_search`；供应商 hosted tool 仅在隔离的搜索模型请求中出现。
- 所有 provider-specific citation/grounding 先归一化，再进入主模型、SSE 和持久化。
