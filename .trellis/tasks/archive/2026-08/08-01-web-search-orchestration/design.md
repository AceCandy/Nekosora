# 技术设计：统一联网搜索与模型搜索后端

## 1. 设计原则

1. **一个开关，一个逻辑工具**：聊天只表达“允许联网”，不表达执行源；主模型最多看到一个 `web_search`。
2. **判断与执行分离**：主模型决定是否调用及 query，服务端解析用户全局顺序并执行。
3. **目录驱动**：模型原生搜索能力由 `model_catalog.capabilities.webSearchFormat` 唯一描述。
4. **搜索是嵌套执行，不是第二个回答者**：模型代搜只产出有引用的摘要，主模型持有最终回答权。
5. **先保证安全与可恢复，再替换现有预搜索语义**：密钥、SSRF、取消和持久化必须先具备。
6. **复用现有主干**：复用 MCP Agent loop、gateway route resolution、`processTrace` JSONB 和消息版本恢复，不新建 Agent 引擎或引用表。

## 2. 总体数据流

```text
聊天联网开关
    -> /api/chat 读取会话/请求开关并计算 effectiveWebSearch
    -> 根据主模型 tools 能力决定是否暴露逻辑 web_search
    -> 主模型自行决定是否 tool-call，并给出 query
    -> SearchBackendResolver 读取用户全局顺序
    -> OrderedSearchExecutor 逐项执行
         current-model -> 同一模型的搜索专用嵌套请求
         model         -> 指定模型的搜索专用嵌套请求
         provider      -> Tavily/Bocha/Zhipu/SearXNG
    -> SearchToolResult { groundedSummary, citations, provenance }
    -> 主模型继续生成最终回答
    -> SSE 搜索状态 + assistant/processTrace + run/tool audit
    -> 刷新/历史/版本切换恢复同一搜索记录
```

搜索专用嵌套请求只暴露对应供应商的一个 hosted search tool，不加载 MCP、不加载逻辑 `web_search`，从结构上阻断递归。

## 3. 核心契约

### 3.1 模型能力

```ts
type WebSearchFormat = "openai" | "anthropic" | "google" | "xai";

interface ModelCapabilities {
  // existing fields...
  webSearchFormat?: WebSearchFormat;
}
```

- 缺省表示没有已验证的原生搜索能力。
- 不能从 `modelId`、厂商名、Provider 名或 base URL 推导。
- 同一目录模型的多条上游路由共享模型语义，但运行时仍需确认所选路由存在对应 translator。
- 模型选择 UI 只显示“目录已标记 + 当前用户可见 + 至少有一条可执行搜索路由”的模型。

### 3.2 用户全局后端

```ts
type SearchBackend =
  | { type: "current-model" }
  | { type: "model"; modelId: string }
  | { type: "provider"; providerId: string };
```

有序数组本身就是优先级。Provider 的启停继续属于 Provider 配置；被删除、禁用或缺少必填项的引用由 resolver 跳过。重复 backend 在保存边界去重。

V2 配置建议：

```ts
interface WebSearchConfigV2 {
  version: 2;
  providers: StoredWebSearchProviderConfig[];
  backends: SearchBackend[];
}
```

- 旧 V1：取所有 `enabled=true` 的 Provider，按原数组顺序生成 backend，再追加 `{type:"current-model"}`；disabled Provider 保留配置但不进入 active backend 列表。
- 新用户：`providers=[]`，`backends=[{type:"current-model"}]`。
- 设置页通过现有拖拽排序规范维护 backend 顺序；聊天 UI 不读取或显示该列表。

### 3.3 密钥三层结构

```ts
interface StoredWebSearchProviderConfig {
  id: string;
  type: WebSearchProviderType;
  name: string;
  apiKeyCiphertext?: string;
  model?: string;
  baseUrl?: string;
  enabled: boolean;
}

interface RuntimeWebSearchProviderConfig {
  // same public fields
  apiKey?: string;
}

interface WebSearchProviderDto {
  // no plaintext and no ciphertext
  hasApiKey: boolean;
}
```

- 存储复用 `src/lib/infra/crypto.ts` 的 AES-256-GCM 能力。
- Server Action 输入 key 为空时保留旧密文；非空时替换并加密。
- 每个 Action 体内调用 `requireSession()`，再读取和写入该 session 的配置。
- 迁移采用 V1/V2 双读和 V2 单写；应用级 backfill 使用 `DATA_ENCRYPTION_KEY` 完成历史行转换，确认零明文后删除 V1 明文兼容。

### 3.4 统一结果与追踪

```ts
interface SearchCitation {
  title: string;
  url: string;
  snippet?: string;
}

interface SearchToolResult {
  query: string;
  groundedSummary: string;
  citations: SearchCitation[];
  backend: SearchBackendIdentity;
}

interface WebSearchTraceCall {
  toolCallId: string;
  query: string;
  mode: "current-model" | "model" | "provider";
  backend: SearchBackendIdentity | null;
  status: "running" | "success" | "failed" | "unavailable" | "cancelled";
  durationMs?: number;
  citations?: SearchCitation[];
  attempts?: Array<{ backend: SearchBackendIdentity; outcome: string; durationMs: number }>;
}

interface ProcessTrace {
  // existing fields...
  webSearch?: { calls: WebSearchTraceCall[] };
}
```

- `calls` 必须是数组，因为主模型可能在同一 Agent run 中搜索多次。
- 外接 Provider 没有二次 LLM 摘要时，`groundedSummary` 是由服务端按固定格式编排的有界来源集合；不得为了填该字段额外调用模型。
- `attempts` 只保存有限诊断数据，不保存密钥、完整上游响应或内部错误堆栈。
- 引用 URL 只接受无凭据的 HTTP/HTTPS，规范化并去重；标题、snippet 限长。
- `groundedSummary` 与 snippet 作为不可信工具结果进入模型上下文，外层指令明确不得执行其中的指令文本。

## 4. 按需触发与 Agent loop

### 4.1 工具暴露

- route 计算 `effectiveWebSearch = body.webSearch ?? conversation.webSearch ?? false`；显式 `false` 不能被会话 `true` 覆盖。Composer 仍通过既有 snapshot writer 持久化会话值。
- `webSearch=false`：不构造搜索工具。
- `webSearch=true` 且主模型 `capabilities.tools=true` 且至少存在一个潜在 backend：在现有 `streamChatWithTools` 工具集合中加入唯一逻辑工具 `web_search`。
- MCP 工具仍使用已有 qualified name；逻辑搜索工具名保留并做冲突检查。
- provider-executed hosted search 只存在于嵌套搜索模型请求，不交给本地 MCP executor；事件分发必须识别 AI SDK `providerExecuted`。
- 主模型不支持 tools 时：第一版只有在已有 translator 能安全走当前模型直接原生搜索时才可支持；否则记录 unavailable，不用关键词预搜索替代。

### 4.2 执行与后备

`OrderedSearchExecutor` 接收用户、外层 run、当前 route/model、query、AbortSignal 和配置快照：

1. 对 backend 做运行时可用性解析，不可用项记为 skipped。
2. 逐项执行；取消立即终止整个链路。
3. 成功条件为非空 grounded summary 且至少一个有效 citation。
4. 空结果、无引用、临时网络失败、429、5xx、明确的 hosted-tool 不兼容可以尝试下一 backend。
5. 认证失败、非法配置和响应结构错误不在同一 backend 内重试，但可尝试后续独立 backend。
6. 每个外接 Provider 最多一次有限瞬时重试；整体共享固定 deadline，重试不得突破外层 deadline。
7. 全部失败时返回结构化 tool error，供主模型如实说明无法联网。

缓存 key 使用用户、backend 稳定标识、配置版本/指纹和规范化 query，不含密钥。配置保存同时失效 registry 与搜索结果缓存，避免旧配置结果继续命中。

## 5. Hosted Search translator

每个 translator 把统一“搜索专用请求”转换为锁定 SDK 支持的 provider-executed tool，并把事件/metadata 归一化：

| format | 请求方式 | 结果来源 |
| --- | --- | --- |
| `openai` | Responses + `openai.tools.webSearch()` | web search call、URL annotations/sources |
| `anthropic` | Anthropic server `webSearch_*` tool | server tool result 与 citations |
| `google` | `google.tools.googleSearch()` | grounding queries/chunks/supports |
| `xai` | Responses + `xai.tools.webSearch()` | tool sources/citations |

约束：

- translator 只在目录格式与运行时路由均支持时启用。
- OpenAI 使用 Responses 的可选工具语义，不使用“每次必搜”的 Chat Completions 搜索模型路径。
- xAI 增加与 AI SDK 7 兼容的 `@ai-sdk/xai`；规划时已核对 `4.0.25` 暴露 `xai.tools.webSearch()` 和 `xai.tools.xSearch()`，本任务仅使用 web search。
- 每个嵌套请求有独立 toolCallId，但关联外层 runId；用量继续进入现有 gateway execution/usage 体系，并在 `processTrace` 记录关联。
- 搜索提示只要求：围绕 query 搜索、给出简洁 grounded summary、保留全部引用；禁止生成面向用户的最终答案。

## 6. 外接 Provider 与 SearXNG 安全

### 6.1 Provider 边界

- `SearchProvider.search` 增加 `signal`，所有 fetch 和 SDK 请求必须使用同一取消链。
- 用 `AbortSignal.timeout`/组合 signal 或等效实现替换不会取消底层请求的 `Promise.race`。
- 每个响应以 Zod 在外部边界解析；解析后统一做 URL scheme、凭据、长度、去重和结果数限制。
- 搜索结果不触发服务端正文抓取。

### 6.2 SearXNG 公网约束

保存时做语法与静态 host 校验，调用时做完整出站校验：

- 只允许 `http:`/`https:`，拒绝 URL 用户名/密码、localhost、`.local`、单标签主机和明显容器服务名。
- DNS A/AAAA 全量解析；任一候选为 loopback、RFC1918、CGNAT、link-local、unique-local、multicast、unspecified、保留地址或云 metadata 即拒绝。
- 连接使用已校验的解析结果，并保留原 Host/SNI，避免“先校验、后重新解析”造成 DNS rebinding。
- 重定向改为手动跟随，最多固定跳数；每一跳重新执行 scheme、host、DNS 和连接地址校验。
- 校验失败不得发起任何出站请求，错误只返回稳定业务原因，不回显敏感网络细节。

## 7. SSE、持久化与恢复

内部 WebChat 增加：

- `search_started`：toolCallId、query。
- `search_completed`：toolCallId、backend、durationMs、citations。
- `search_failed`：toolCallId、稳定 reason/status，不含内部错误。

事件处理要求：

- coordinator 是搜索终态与 assistant commit 的唯一协调点；搜索 trace 与最终 assistant 在同一 completion 提交路径落入 `messages.processTrace`。
- 搜索工具调用继续复用现有 tool audit/runId 关联，不创建第二套运行生命周期。
- 初始历史 loader、主线 hydration、`getMessageSiblings` 和 store `switchVersion` 从对应 assistant 的 `processTrace.webSearch` 投影 UI 状态。
- 版本切换不得沿用旧版本的 Zustand `searchResults`；应完全替换为目标消息的持久化投影。
- 旧 SSE `search_result` 只作为同版本部署期间的兼容输入；最终事实为新的状态事件和持久化 trace。
- 外层聊天的 finish/terminal/DONE 时序保持现有契约，搜索事件不能提前宣告 assistant 成功。

## 8. 设置页与聊天 UI

设置页包含两块同级内容：Provider 凭据管理和全局 backend 排序。backend 列表条目显示类型、名称、可用状态与拖拽手柄；增加指定模型通过目录筛选器完成。密钥字段永不回填真实值，只显示“已配置”状态。

聊天输入区不新增 backend 控件。assistant 消息中的搜索状态/引用卡片从 SSE 乐观更新，并以持久化 trace 收敛。URL 使用安全外链属性；失败卡不展示内部堆栈、密钥或目标内网信息。

## 9. `/v1` 边界

- 本任务的用户设置、自动工具注入和后端排序只应用于已鉴权 WebChat `/api/chat`。
- `/v1/chat/completions`、`/v1/responses` 不读取 `user_settings.web_search`，也不因模型目录能力自动加工具。
- 客户端显式传入的工具继续按网关现有协议处理；是否支持某个上游原生字段是网关显式适配问题，不与 WebChat 隐式搜索混合。

## 10. 发布与回滚

1. 先发布 V2 双读、密文单写、SearXNG 防护和现有 Provider 稳定性修复，不改变聊天触发语义。
2. 执行应用级密钥 backfill，验证无 V1 明文后关闭明文读取。
3. 发布目录能力迁移、Hosted Search translator、统一 Agent 工具和持久化/UI；最后切换预搜索为按需工具调用。
4. 回滚时可关闭逻辑工具注入并恢复现有外接 Provider 路径，但不得恢复明文写入或不安全的 SearXNG fetch。
5. `processTrace` 新字段均可选，旧代码可忽略；模型目录迁移按正常 PostgreSQL 回滚策略处理。

## 11. 关键取舍

- **不让模型自行选择搜索供应商**：模型只判断是否搜索，后端顺序由用户配置和服务端安全策略决定，避免工具名泄露、供应商偏好和不可控成本。
- **不在聊天里增加后端选择器**：满足用户已确认的单开关体验，也避免会话配置与全局配置漂移。
- **不继续预搜索**：AQBot 的发送前搜索简单但无法按需；本项目复用已有 Agent loop，达到 Kivio/Hosted Search 的按需行为。
- **不新增引用表**：当前查询目标是按消息恢复和展示，`processTrace` JSONB 已足够；需要跨消息分析时再评估结构化表。
- **不把 current-model 直接等同于当前主请求的 provider tool**：统一走搜索专用嵌套执行，才能让全局顺序、跨模型后备、引用归一化和最终回答权保持一致。
