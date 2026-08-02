# 实施计划：统一联网搜索与模型搜索后端

## 成功门槛

- 所有 PRD 验收项有对应自动化测试或明确的人工验证步骤。
- 安全与迁移阶段可以独立发布、独立回滚；按需搜索切换只在完整链路就绪后启用。
- 每阶段结束做一次独立复核，检查实现是否偏离 `model_catalog` 唯一事实来源、单工具和单开关约束。

## 主要受影响文件地图

| 领域 | 现有入口 | 计划职责 |
| --- | --- | --- |
| 搜索类型/配置 | `src/lib/web-search/types.ts`、`registry.ts` | V2 DTO、密文配置、全局 backend 顺序、缓存失效 |
| 外接执行 | `src/lib/web-search/service.ts`、`tavily.ts`、`bocha.ts`、`zhipu.ts`、`searxng.ts` | Abort、重试、响应校验、URL 归一化、SSRF |
| 聊天准备 | `src/app/api/chat/route.ts`、`src/lib/chat/orchestrator.ts` | effective 开关、移除预搜索、构造单一逻辑工具 |
| Agent/Provider | `src/lib/chat/completion-coordinator.ts`、`src/lib/stream.ts`、`src/lib/providers/*` | 工具合并、Hosted Search translator、嵌套模型搜索、用量关联 |
| 能力目录 | `src/db/types.ts`、模型目录 repository、`scripts/sync-pi-models.ts`、`drizzle/pg/*` | `webSearchFormat`、目录数据迁移、journal/snapshot |
| SSE/持久化 | `src/lib/chat/sse-contract.ts`、completion repository、消息历史 actions | 搜索事件、`processTrace.webSearch`、版本投影 |
| 前端状态/UI | `src/features/chat/model/sse.ts`、`chatStreamStore.ts`、搜索设置页与 `WebSearchManager.tsx` | 状态收敛、引用恢复、backend 排序、密钥脱敏 |

该表用于定位，不授权无关重构；执行时以当前工作树和 CodeGraph blast radius 为准。

## 阶段 0：基线与契约锁定

- [ ] 为现有 `registry/service/searxng/orchestrator` 行为补最小回归测试，固定旧配置读取、首个 Provider、预搜索和 SSE 现状。
- [ ] 固定并测试 `effectiveWebSearch = body.webSearch ?? conversation.webSearch ?? false`，覆盖显式 false、请求缺省、刷新与新会话 adopt。
- [ ] 在 `src/lib/web-search/types.ts` 定义 V2 存储/运行时/客户端 DTO、`SearchBackend`、统一 citation/result/trace 类型与 Zod 边界 schema。
- [ ] 扩展 `ModelCapabilities.webSearchFormat`，同步模型目录类型、匹配器、同步脚本和测试契约；此时不填未经核验的模型。
- [ ] 明确 feature switch/切换点，使安全改动可先上线而按需 Agent 语义暂不启用。

验证：

```bash
pnpm test -- src/lib/web-search src/lib/chat/orchestrator.test.ts src/lib/model-catalog.test.ts
pnpm typecheck
```

回滚点：仅类型与回归测试，不改变生产行为。

## 阶段 1：P0 安全与配置 V2

### 1.1 密钥与鉴权

- [ ] 复用 `src/lib/infra/crypto.ts` 加密搜索 key；实现 V1/V2 双读、V2 密文单写。
- [ ] 页面只接收 `WebSearchProviderDto`，以 `hasApiKey` 表示状态；编辑空 key 保留，非空替换。
- [ ] 将页面闭包 Server Action 改为动作体内 `requireSession()`，所有读写使用实时 session userId。
- [ ] 清理所有可能输出 key、密文、查询正文和完整上游响应的日志/错误路径。
- [ ] 提供应用级历史明文 backfill 与 dry-run/计数校验；迁移完成后增加“零 V1 明文”检查并移除明文写入。

### 1.2 SearXNG 公网出站

- [ ] 新建集中出站 URL 校验/安全请求 helper，覆盖 HTTP(S)、host、A/AAAA、非公网网段和连接时地址固定。
- [ ] SearXNG 保存时先校验；请求时重新校验，并手动逐跳验证有限重定向。
- [ ] 覆盖 IPv4、IPv6、DNS rebinding、metadata、单标签/Docker 名称、HTTP 到 HTTPS 合法跳转和公网实例。

验证：

```bash
pnpm test -- src/lib/web-search/registry.test.ts src/lib/web-search/searxng.test.ts
pnpm test -- 'src/app/(dash)/panel/web-search'
pnpm typecheck
```

人工检查：浏览器 props/Network 不出现完整 key；数据库目标配置只含密文。

回滚点：保留 V2 读写与安全请求 helper；禁止回滚到明文写入或未校验 fetch。

## 阶段 2：P1 有序后端与可靠执行

- [ ] 把 `resolveProvider` 改为解析用户有序 `SearchBackend[]` 的 resolver；保存时去重并校验引用属主/可见性。
- [ ] 实现 V1 -> V2 顺序迁移：已启用 Provider 保持相对顺序，末尾追加 current-model；新用户仅 current-model。
- [ ] 将外接 Provider 接口改为接收 AbortSignal；统一整体 deadline、单次超时和有限瞬时重试。
- [ ] 替换 `Promise.race` 假超时，保证取消能到达 fetch/SDK；清理 timer 和 iterator。
- [ ] 所有 Provider 响应经 Zod 解析、HTTP(S) URL 过滤、凭据剥离、规范化去重、数量/长度限制。
- [ ] 缓存 key 加入 backend/config 指纹；保存配置同时失效 registry 与结果缓存。
- [ ] 为排序、不可用跳过、空结果后备、认证错误、429/5xx、Abort 和缓存隔离建表驱动测试。

验证：

```bash
pnpm test -- src/lib/web-search
pnpm typecheck
```

回滚点：可暂时只执行排序后的首个外接 Provider，但保留新配置、安全与真实取消。

## 阶段 3：P2 搜索事件、追踪与版本恢复

- [ ] 扩展 `ProcessTrace.webSearch.calls`，保持旧记录可选字段兼容。
- [ ] 在内部 SSE 契约增加 `search_started/completed/failed`，更新 serializer、parser 和错误矩阵。
- [ ] coordinator 汇总搜索调用并随 assistant completion 事务写入 `messages.processTrace`；保持 finish -> terminal -> DONE 契约。
- [ ] 初始历史、主线 hydration、siblings/branch、regenerate/continue 路径投影搜索 trace。
- [ ] Store 按 toolCallId 更新运行中状态，版本切换时用目标消息投影完全替换而非清空/沿用旧结果。
- [ ] 引用卡支持成功、失败、取消和旧消息无 trace 状态；URL 可点击且安全。

验证：

```bash
pnpm test -- src/lib/chat/completion-coordinator.test.ts src/lib/chat/completion-repository.test.ts
pnpm test -- src/app/api/chat/route.test.ts src/features/chat/model/sse.test.ts
pnpm test -- src/features/chat/actions/branch.test.ts src/features/chat/store/chatStreamStore.test.ts
pnpm typecheck
```

人工检查：搜索中的消息刷新、成功后刷新、回复版本来回切换、重新生成和继续生成均显示正确来源。

回滚点：新 trace 字段可被旧 UI 忽略；不要删除已写入的 JSONB 数据。

## 阶段 4：P3 Hosted Search 与跨模型代搜

### 4.1 Translator 与目录数据

- [ ] 分别实现 OpenAI Responses、Anthropic server search、Google grounding、xAI Responses translator。
- [ ] 引入并锁定与 AI SDK 7 兼容的 `@ai-sdk/xai`，审查 lockfile、peer dependency、发布内容与许可证。
- [ ] 从官方资料与 `pi.dev/api/models` 核验当前主流 GPT/Claude/Gemini/Grok 的模型 ID 和搜索格式；不得按名称推断。
- [ ] 提供 PostgreSQL 数据迁移更新 `model_catalog.capabilities`，同步 Drizzle journal/snapshot。
- [ ] 为 translator 请求体、provider-executed tool 识别、citation/grounding 归一化和无引用失败补 fixture 测试。

### 4.2 搜索专用嵌套请求

- [ ] 实现 `executeHostedModelSearch`：复用用户可见路由、外层 runId 和取消链，但禁用 MCP 与逻辑 web_search。
- [ ] current-model 解析为当前 modelId；model backend 解析指定 modelId，并在每次执行时重新校验可见性与路由能力。
- [ ] 搜索提示只生成 grounded summary/citations；无引用不得视为成功。
- [ ] 嵌套用量进入现有 gateway execution/usage 体系，并关联外层 runId/toolCallId。

### 4.3 单一逻辑工具

- [ ] 将逻辑 `web_search` 合并到现有 `streamChatWithTools` 工具集合；联网关闭时不加入。
- [ ] 主模型工具调用交给 OrderedSearchExecutor，依用户顺序执行 current-model/model/provider。
- [ ] 明确区分本地执行工具和 AI SDK `providerExecuted` 工具，防止 hosted search 被 MCP executor 二次执行。
- [ ] 全部失败返回结构化工具错误，主模型继续完成可诚实降级的回答。
- [ ] 移除 `orchestrator` 的每轮预搜索与 system prompt 直接注入，仅保留兼容切换代码到发布稳定后删除。

验证：

```bash
pnpm test -- src/lib/providers src/lib/stream.test.ts src/lib/stream-agent-loop.test.ts
pnpm test -- src/lib/chat/orchestrator.test.ts src/lib/chat/completion-coordinator.test.ts
pnpm test -- src/lib/model-catalog.test.ts src/lib/sync-pi-models.test.ts
pnpm check
pnpm test
pnpm build
```

集成矩阵：

| 主模型 | 第一个可用后端 | 预期 |
| --- | --- | --- |
| 支持 tools 的普通模型/GLM | Grok/GPT/Gemini/Claude | 主模型调用一次逻辑工具，搜索模型返回引用，主模型最终回答 |
| GPT/Claude/Gemini/Grok | current-model | 同一模型的搜索专用嵌套请求使用对应 hosted search |
| 任意支持 tools 的模型 | Tavily/Bocha/Zhipu/SearXNG | 外接结果归一化后回给主模型 |
| 任意支持 tools 的模型 | 首项失败、次项成功 | trace 记录尝试顺序，只返回成功后端结果 |
| 不支持 tools 且无直接原生路径 | 任意 | 明确 unavailable，不做预搜索伪装 |

回滚点：关闭逻辑工具 feature switch，恢复外接 Provider 旧触发路径；保留安全、配置 V2、目录字段与追踪兼容。

## 阶段 5：设置 UI、兼容收口与独立复核

- [ ] 设置页增加 backend 拖拽排序、添加搜索模型、current-model 条目和不可用状态；聊天输入区保持一个开关。
- [ ] 搜索模型候选仅来自服务端目录/权限 DTO，不在前端判断模型名。
- [ ] 核对 `/v1` 未读取用户搜索配置、未隐式注入工具，现有显式工具测试保持绿色。
- [ ] 移除 V1 明文兼容与旧 `search_result` 兼容前，先验证生产/测试数据已完成迁移。
- [ ] 更新 `.trellis/spec/backend/web-search.md`，把“首个 enabled”旧契约替换为 V2 排序、按需工具、Hosted Search、安全与持久化契约。
- [ ] 运行独立 Trellis check，逐项核对 PRD、跨层数据往返、鉴权、取消、迁移、敏感信息与无关 diff。

最终验证：

```bash
pnpm check
pnpm test
pnpm build
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-01-web-search-orchestration
```

未通过完整集成矩阵、迁移一致性和独立复核前，不宣告实施完成。

## 执行记录（2026-08-01）

已完成：按需单逻辑工具、用户级有序后端、四类 Hosted Search、外接 Provider 降级、
SearXNG 公网出站约束、V2 密文配置与回填脚本、搜索 trace/SSE/历史恢复、设置页模型候选与排序、
`/v1` 隔离回归。续写会保留同一 assistant 已有搜索 calls，再追加新一轮 calls，避免刷新后旧引用丢失。

已验证：

- `pnpm check` 通过。
- `pnpm test`：120 个文件通过、2 个文件按既有条件跳过；1060 项通过、17 项跳过。
- `pnpm build` 在 Next `15.5.21` 与干净缓存上通过。
- `pnpm install --frozen-lockfile --offline` 通过；Next 及 `eslint-config-next` 均精确锁定为 `15.5.21`，Sharp `0.35.3` 可正常加载。
- `pnpm audit --prod --audit-level moderate` 未发现已知漏洞。
- 迁移 journal/snapshot 连续；锁文件仅包含 `@ai-sdk/xai@4.0.16` 与 Next `15.5.20 -> 15.5.21` 的必要变更，独立只读复核未发现无关依赖漂移。

未执行：生产数据库迁移、`backfill:web-search-keys --apply`、带真实 Provider 凭据的联网集成矩阵、
登录态浏览器人工交互验证。这些操作依赖部署环境、生产数据或真实密钥，不在本地自动执行。

已处理原剩余风险：`next` 与 `eslint-config-next` 已升级并精确锁定到 `15.5.21`，生产依赖审计清零。

### ModelMessage 工具消息回归修复（2026-08-01）

- 根因类别：跨层契约 + 测试覆盖缺口。Agent loop 将 OpenAI IR 的 `assistant.tool_calls` 与
  `role: "tool"` 原样回灌到下一轮，而 AI SDK 7 在运行时要求 `tool-call` / `tool-result`
  content parts，因此联网搜索执行后的第二轮请求触发 `ModelMessage[]` schema 校验失败。
- 修复位置：统一在 `toModelMessages` 边界完成工具调用与工具结果转换，不改变 Agent loop、
  网关 IR 或搜索执行器的内部表示。
- 防复发：新增真实 `modelMessageSchema` 回归，并更新多工具 Agent-loop 测试，锁定第二轮
  `streamText` 实际收到的消息形状；同步补全 `model-message-boundary` 规范。
- 已验证：`src/lib/stream.test.ts` 与 `src/lib/stream-agent-loop.test.ts` 共 48 项通过，
  `pnpm check` 通过；全量测试 120 个文件通过、2 个跳过，1061 项通过、17 项跳过；
  清理 `.next` 缓存后的 Next `15.5.21` 生产构建通过。

### AI SDK ToolSet 边界回归修复（2026-08-02）

- 根因类别：跨层契约 + 测试覆盖缺口。`IRToolDef[]` 被直接强转为 AI SDK 7 的
  `ToolSet`；SDK 按对象键枚举数组后把首个工具发布为 `"0"`，同时丢失输入 schema。
- 修复位置：统一在 `streamWithRoute` 调用 `streamText` 前按 `function.name` 转成
  `ToolSet`，保留 description/parameters，不改变 OpenAI IR、MCP registry 或搜索执行器。
- 防复发：回归测试断言 `streamText.tools` 不是数组、键为 `web_search`、输入 schema
  保留 `query`，且不提供会绕过现有 Agent loop 的 `execute`。
- 已验证：定向测试 49 项通过；`pnpm check`、`git diff --check` 通过；全量测试
  120 个文件通过、2 个跳过，1062 项通过、17 项跳过。使用 `step-3.5-flash`
  的真实聊天产生 3 条 `web_search` 成功记录，输入均含 `query`，每条搜索 trace
  均关联 Tavily 后端和 5 条引用。

### 路由级工具能力修复（2026-08-02）

- 根因类别：能力边界错误。系统只读取 `model_catalog.capabilities.tools`，把模型语义
  错当成每条 Provider 路由的实际兼容性；2API 路由可能把工具调用 JSON 当普通正文。
- 修复位置：`routes.supports_tools` 默认关闭；路由表单显式配置。WebChat 工具预检、
  gateway attempt、Hosted Search runtime 与候选模型均要求目录和路由两层能力同时成立。
- 防复发：新增迁移、路由动作、解析、混合路由故障转移和 Hosted Search 回归测试，
  并把该契约写入 gateway routing 与 web search 规范。
- 已验证：`pnpm typecheck`、`pnpm lint`、功能相关测试（116 项）与生产构建通过；
  本次代码完成后的首次全量测试为 1074 项通过、17 项跳过。追加 1 项 Hosted Search
  回归后，后续全量复跑受共享环境 I/O 抖动影响触发既有 5 秒超时；涉及的 3 个文件
  隔离复跑为 35 项全部通过。
