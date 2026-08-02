# 参考项目搜索实现对比

## Kivio

- `src-tauri/src/chat/types.rs` 把搜索分为 Off、Builtin、ThirdParty。
- ThirdParty 向模型暴露一个 `native__web_search`；Builtin 通过 provider 请求能力注入，不同时暴露外接工具。
- `src-tauri/src/web_search.rs` 支持 Tavily、Exa、Exa MCP、Ollama、Grok；Grok 使用 xAI Responses `web_search`。
- 模型在能力已暴露后决定是否调用，未发现关键词分类器强制搜索。
- Builtin 搜索的 query/citation 被聚合为结构化 tool record，并随 assistant 消息恢复。
- Kivio 支持跨 provider 的 sub-agent 模型覆盖，但子代理强制 `web_search_mode: Off`；它不是“一个模型委托另一个模型专门联网搜索”的实现。

可借鉴：模式/工具门控分离、单工具、Hosted Search citation 归一化、结构化持久化。

不直接照搬：聊天三态选择器与本项目“聊天只留一个开关、全局排序”的产品决策冲突。

## AQBot

- 支持 Tavily、Exa、智谱和 Bocha。
- 前端发送消息前先生成 query、执行搜索，再把结果文本注入最终消息内容。
- Provider 按会话保存，存在引用 DTO。
- 未发现模型原生 hosted search 或跨模型代搜。

可借鉴：Provider 结果公共 DTO 与引用关联。

不采用：发送前固定预搜索，无法满足主模型按需调用。

## DEEIX-Chat

- 内置搜索主要是 OpenAI、Anthropic、Google、xAI 的供应商 Hosted Search 工具透传，并非自建搜索引擎。
- 前端根据后端 native tool catalog 展示并提交工具配置，后端负责 allowlist 和请求治理。
- 通用 MCP 可间接接入外部搜索，但没有内置 Tavily/SearXNG 执行器。

可借鉴：供应商工具目录、后端最终治理、Hosted Search 事件/引用解析。

不采用：逐 native tool 的聊天配置 UI；本项目保持单一联网开关。

## LiveAgent

- 参考目录中存在 `nativeWebSearch.ts`、`nativeSearchPayload.ts`、`hostedSearchEvents.ts` 及对应测试，面向 OpenAI、Anthropic、Gemini、xAI 归一化 hosted search。
- 可作为 translator fixture 和事件聚合的实现参考，实施前需按当前依赖版本复核。

## “龙虾 / Hermes”名称说明

当前 `docs/cankao` 没有名为 OpenClaw 或 Hermes 的完整源码项目；仅 Kivio 中存在 `hermes.svg` 图标。因而不能把 Kivio 行为写成 OpenClaw/Hermes 的实现事实。若后续补充准确仓库地址，应单独核验并更新本研究文件，不影响本任务已经基于可验证源码形成的架构决策。

公开仓库身份已通过 Gread 核对：`ZMGID/kivio`、`AQBot-Desktop/AQBot`；具体实现依据本地 `docs/cankao` 工作树。
