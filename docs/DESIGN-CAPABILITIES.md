# Nekusora 能力补齐设计方案

> **版本**:v1.0 · **日期**:2026-06-19
> **基线**:本方案所有挂载点均已对照现有代码确认 —— IR(`src/lib/providers/types.ts`)、`streamChat()`(`src/lib/stream.ts`)、四表路由器(`src/lib/routing.ts`)、`CallContext`、`context-assembler` 槽位、`worker`/pg-boss、降级基建、admin server actions、Better Auth + admin 插件。
> **范围**:P1 现代 AI 工作台标配(MCP / Artifact / 多模态 / 图像语音)+ P2 规模化(对象存储 / Prompt 库 / 运维监控)共 7 项。

---

## 目录

- [设计总览(7 项能力挂载图)](#设计总览7-项能力挂载图)
- [P1-A — MCP (Model Context Protocol) 双向支持](#p1-a--mcp-model-context-protocol-双向支持)
- [P1-B — Artifact / Canvas 面板](#p1-b--artifact--canvas-面板)
- [P1-C — 多模态聊天上传(vision 图片)](#p1-c--多模态聊天上传vision-图片)
- [P1-D — 图像生成 / 语音端点](#p1-d--图像生成--语音端点)
- [P2-A — 对象存储适配(StorageDriver 抽象)](#p2-a--对象存储适配storagedriver-抽象)
- [P2-B — Prompt 库 / Agent 模板](#p2-b--prompt-库--agent-模板)
- [P2-C — 运维监控(healthz / metrics / 图表)](#p2-c--运维监控healthz--metrics--图表)
- [汇总:交叉影响、迁移路径、分阶段路线图](#汇总交叉影响迁移路径分阶段路线图)

---

## 设计总览(7 项能力挂载图)

```
                         ┌─────────────────────────────────────────────┐
   客户端 / SDK            │            streamChat() 统一流式核心          │
  ┌──────────┐            │  resolveRoutes → buildModel → streamText     │
  │ WebChat  │◄──────────►│                                              │
  │ /v1 API  │            │  新增挂载点:                                  │
  └────┬─────┘            │   • IRRequest.tools (MCP,P1-A)              │
       │                  │   • IRContentPart.image_url (vision,P1-C)    │
       │                  │   • tool-call 事件回路 (P1-A)                │
       │                  └──────────────────┬──────────────────────────┘
       │                                     │
  ┌────▼─────────────────────────────────────▼──────┐
  │  新端点层                                          │
  │   • /v1/images/generations  (P1-D)               │
  │   • /v1/audio/transcriptions (P1-D)              │
  │   • /v1/images:multipart     (P1-D vision 回传)  │
  │   • /healthz /healthz/ready /metrics (P2-C)      │
  │   • /v1/mcp (P1-A, MCP Server 侧)                │
  └────┬─────────────────────────────────────────────┘
       │
  ┌────▼───────────────────────────────────────────────┐
  │  基建层(全部沿用降级模式)                            │
  │   • StorageDriver 抽象 (P2-A) ──► Local/S3/R2/MinIO │
  │   • prompt_templates 表 + 模板服务 (P2-B)           │
  │   • mcp_servers 表 + MCPRegistry (P1-A)            │
  │   • health/metrics 收集器 (P2-C)                   │
  └────────────────────────────────────────────────────┘

  WebChat 前端新增:
   • Composer 多模态粘贴 (P1-C)
   • Artifact 右侧面板 (P1-B)
   • MCP/工具开关 + prompt 选择器 (P1-A, P2-B)
```

---

## P1-A — MCP (Model Context Protocol) 双向支持

### 设计目标

让 Nekusora 同时成为 **MCP Host**(消费外部 MCP server 的工具)和 **MCP Server**(把自己的能力暴露给 Claude Desktop / Cursor 等客户端)。这是当前最大的能力缺口 —— `toolCalls` 表存在但 `streamChat` 第 161 行注释着"工具调用后续阶段接入",从未接通。

### 数据模型(新增 1 表)

```typescript
// 新增表:mcp_servers(管理员配的外部 MCP server,或用户 BYO)
export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey().default(uuid),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }), // null=全局
  name: text("name").notNull(),
  transport: text("transport").notNull(),        // "stdio" | "sse" | "http"
  command: text("command"),                      // stdio 模式
  args: text("args", { mode: "json" }).$type<string[]>(),
  envEnc: text("env_enc"),                       // 环境变量加密(AES-GCM,复用 crypto.ts)
  url: text("url"),                              // sse/http 模式
  headersJson: text("headers_json", { mode: "json" }).$type<Record<string,string>>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // 运行时缓存:最近一次 tools/list 的结果(避免每轮对话都握手)
  cachedTools: text("cached_tools", { mode: "json" }).$type<McpToolDef[]>(),
  lastConnectedAt: integer("last_connected_at", { mode: "timestamp" }),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});
// 索引:userId(查用户级)+ enabled
```

`accessScope` 沿用现有约定:`userId=null` 为全局(管理员配,所有用户可用),非 null 为用户私有 BYO。

### 核心接口

**新建 `src/lib/mcp/registry.ts`**(对标 `providers/registry.ts` 的职责):

```typescript
/** 一个已解析的 MCP server(已连接、已列举工具)。 */
export interface ResolvedMcpServer {
  id: string;
  name: string;
  tools: McpToolDef[];          // 该 server 暴露的全部工具
  client: McpClient;            // 活跃连接(stdio 子进程 / SSE / http)
}

export interface McpToolDef {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: unknown;         // JSON Schema
}

/** 解析一组 enabled 的 MCP server,返回合并后的工具清单 + 活跃连接池。 */
export async function resolveMcpServers(ctx: CallContext): Promise<ResolvedMcpServer[]>;

/** 把多 server 的工具合并成 IRRequest.tools 格式(给 streamText 用)。 */
export function toIRTools(servers: ResolvedMcpServer[]): IRToolDef[];

/** 执行一次工具调用(路由到对应 server 的 client.callTool)。 */
export async function callMcpTool(
  servers: ResolvedMcpServer[],
  toolCallId: string,
  toolName: string,
  args: unknown,
): Promise<{ result: unknown; isError: boolean }>;
```

**MCP Client 复用官方 SDK**:`@modelcontextprotocol/sdk`,三种 transport 全部支持。stdio 模式在 Next.js server 进程内 spawn 子进程;SSE/http 模式保持长连接复用(用模块级 `Map<serverId, McpClient>` 缓存连接,带 idle timeout 自动回收)。

### 挂载点改造(关键,精确到行)

**1. `stream.ts` —— streamChat 接通工具回路**

当前 `streamWithRoute`(第 148 行)只读 `textStream`,丢弃了 `tool-call` 事件。改为:

```typescript
// streamWithRoute 内,在 streamText 配置中加入 tools
const result = streamText({
  model,
  messages: request.messages as never,
  temperature: request.temperature,
  maxOutputTokens: request.max_tokens,
  topP: request.top_p,
  tools: request.tools,           // ← 新增:来自 MCP 解析
  // tool-call 透传给上层;上层负责调 callMcpTool 并回填
});

// 流式产出增加 tool-call 增量
const toolCallsStream = result.toolCalls; // AI SDK v5 异步迭代器
```

但工具调用是**多轮**的(模型调工具 → 拿结果 → 继续),所以 streamChat 外层需要包一个 **agent loop**(P2-B 的 Agent 模板会复用它):

```typescript
// stream.ts 新增:agent 循环封装
export async function* streamChatWithTools(opts): AsyncGenerator<StreamEvent> {
  let messages = [...request.messages];
  for (let step = 0; step < maxSteps; step++) {
    let pendingToolCalls = [];
    for await (const ev of streamChat({ ctx, request: { ...request, messages, tools } })) {
      if (ev.type === "tool-call") pendingToolCalls.push(ev);
      yield ev; // 透传给 UI 实时显示
      if (ev.type === "finish" && ev.finishReason !== "tool-calls") return; // 真正结束
    }
    if (pendingToolCalls.length === 0) return;
    // 执行工具,把结果作为 tool message 追加,进入下一轮
    for (const tc of pendingToolCalls) {
      const { result } = await callMcpTool(servers, tc.toolCallId, tc.toolName, tc.args);
      messages.push({ role: "tool", tool_call_id: tc.toolCallId, content: JSON.stringify(result) });
      yield { type: "tool-result", toolCallId: tc.toolCallId, result };
    }
  }
}
```

**2. `toolCalls` 表** —— streamChat 的 `finally` 块现在也记录工具调用:

```typescript
// usage.ts 同级新增 logToolCalls(runId, pendingToolCalls)
// 写入 tool_calls 表(已存在,字段齐全:tool_call_id/tool_name/status/input_json/output_json)
```

**3. WebChat `/api/chat`** —— 在 streamChat 前调 `resolveMcpServers(ctx)` 拼装 tools,流式多出 `tool-call` / `tool-result` 事件给前端展开渲染。

**4. 网关 `/v1/chat/completions`** —— 检测请求体 `tools` 字段;若请求方自带 tools 则直接透传(OpenAI 兼容),否则用该 key 绑定的 MCP server 工具集填充。`tool_calls` 帧按 OpenAI 格式输出(第 136 行的 `default: break` 改为转发 tool-call)。

### MCP Server 侧(Nekusora 暴露给外部)

新增端点 **`/v1/mcp`**(SSE transport,标准 MCP 协议),暴露三类工具:

- `search_knowledge`(查 RAG,复用 `retrieve.ts`)
- `list_models`(复用路由器可见模型集)
- `create_conversation`(写库)

鉴权:Bearer sk,复用 `verifyKey()`。这是 Nekusora 作为"知识中枢"被 Claude Desktop / Cursor 挂载的入口。

### 降级策略

- stdio transport 仅 PG 模式可用(SQLite 单进程模式禁止 spawn,避免 worker 缺位)。`resolveMcpServers` 在 SQLite 模式自动过滤掉 stdio server 并 `lastError="stdio_requires_pg"`。
- 连接失败的单个 server 不阻断整轮:跳过 + `yield { type: "mcp-error", serverId }`,工具清单里去掉它的工具。
- `cachedTools` 兜底:连接超时(500ms)则用上次缓存工具集,避免每次对话握手。

### UI 草图

```
ChatComposer 顶部新增一行 "工具" 入口:
┌──────────────────────────────────────────────┐
│ [gpt-4o ▾]  [📎 附件]  [🔧 工具: 2/4 已启用] │
│                                └─► 弹层:     │
│                                    ☑ filesystem  │
│                                    ☑ web_search  │
│                                    ☐ github      │
│                                    ☐ slack       │
└──────────────────────────────────────────────┘
消息流中 assistant 气泡上方插入折叠条:
  🔧 调用 web_search(query="...")  → ✓ 返回 3 条结果
```

Admin 新增 `/admin/mcp` 页(对标 providers 页结构)。

---

## P1-B — Artifact / Canvas 面板

### 设计目标

对齐 Claude Artifacts:当 assistant 输出**代码块 / Mermaid / KaTeX / SVG / HTML** 时,在右侧独立面板渲染,支持复制、下载、全屏、迭代修改。当前 `ChatComposer.tsx` 是单栏 `max-w-3xl`,纯文本流式。

### 数据模型(扩展,不新建表)

复用 `messages` 表的 `content` 字段(JSON,已是 `text` mode)。新增约定:assistant 消息 content 可存**结构化 JSON**:

```typescript
// messages.content 当前是 text;扩展为可选结构化:
type MessageContent =
  | string                                    // 纯文本(向后兼容)
  | { text: string; artifacts: ArtifactRef[] };

interface ArtifactRef {
  id: string;           // 指向 artifacts 表(见下)
  kind: "code" | "mermaid" | "svg" | "html" | "katex" | "markdown";
  title: string;        // "react-component.tsx"
  language?: string;
}
```

**新增轻量表 `artifacts`**(单独存,避免消息体膨胀):

```typescript
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey().default(uuid),
  messageId: text("message_id").notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  language: text("language"),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),   // 迭代版本号
  parentArtifactId: text("parent_artifact_id"),        // 版本链
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
}, (t) => [
  index("artifacts_msg_idx").on(t.messageId),
  index("artifacts_conv_idx").on(t.conversationId),
]);
```

### 核心接口

**新建 `src/lib/artifacts/extract.ts`** —— 流式中实时抽取:

```typescript
/**
 * 流式增量解析器:喂入 text-delta,产出"纯文本段"和"artifact 发现事件"。
 * 用 fenced code block 的 ``` 闭合作为边界信号。
 * 设计为有状态对象(流式场景必须),非纯函数。
 */
export class ArtifactStreamParser {
  private buffer = "";
  private inFence = false;
  private lang = "";
  private fenceStart = 0;

  feed(delta: string): {
    textDelta?: string;
    artifactStart?: { id: string; kind: string; language?: string };
    artifactChunk?: { id: string; chunk: string };
    artifactEnd?: { id: string; title: string };
  };
}

/** 从完整 assistant 文本中抽取全部 artifact(非流式兜底)。 */
export function extractArtifacts(text: string): { text: string; artifacts: ParsedArtifact[] };
```

### 挂载点改造

**1. `/api/chat` route.ts** —— 流式结束后(第 214 行 `finally` 块持久化前),调 `extractArtifacts(assistantText)`:

- 若有 artifact,拆出写 `artifacts` 表,assistant `content` 改存结构化 JSON
- 流式中通过新的 SSE 事件 `artifact` 推送增量给前端实时渲染

**2. `ChatComposer.tsx` 布局改造** —— 当前第 353 行 `flex-1 flex flex-col` 改为可切换单栏/双栏:

```tsx
// 新布局:消息区 + 可关闭的右栏 Artifact
<div className="flex-1 flex">
  <div className={clsx("flex-1 flex flex-col", activeArtifact && "lg:flex-[3] border-r")}>
    {/* 现有消息流 */}
  </div>
  {activeArtifact && (
    <ArtifactPanel className="lg:flex-[2] hidden lg:flex" artifact={activeArtifact} />
  )}
</div>
```

**3. ArtifactPanel 组件**(`src/components/artifacts/`):

- 按_KIND_ 分发渲染器:`react-syntax-highlighter`(已在依赖)→ code;`mermaid`(新依赖)→ mermaid;`katex`(新依赖)→ katex
- 顶部 toolbar:复制 / 下载 / 全屏 / 历史版本(version 下拉)/ "基于此继续对话"(把 artifact 内容回填 Composer)

### 设计原则贴合

DESIGN.md 要求"克制与纯粹"。Artifact 面板遵循:

- 无彩色侧条,用 `border-morning-mist` 细线分隔
- 静止无投影(符合 `shadow-none` 约定)
- 代码渲染沿用现有 `react-syntax-highlighter` 的主题,不引入新配色

### 依赖增量

`mermaid`(约 1.2MB,动态 import 避免 bundle 膨胀)、`katex`(轻量)。两者都用 `next/dynamic` 懒加载,仅在打开对应 artifact 时加载。

---

## P1-C — 多模态聊天上传(vision 图片)

### 设计目标

当前 `ChatComposer` 只支持文本附件(走 RAG 提取链路),且 `ModelCapabilities.vision` 字段已存在(`types.ts` 第 4 行)却从未消费。本项让用户能粘贴/拖拽图片,发给 vision 模型。

### 数据模型(零新增表)

复用 `fileObjects` 表(已有 `mime` 字段)。图片类 mime(`image/*`)的 file:

- **跳过** RAG 处理流水线(`process.ts` 的 `extractText` 对图片返回 `unsupported`,自然跳过 —— 但要在 `extract.ts` 第 31 行显式识别 `image/*` 返回 `reason="image_skipped"`,避免被误标为处理失败)
- 走单独的"图片预处理"分支:生成缩略图(可选,`sharp` 已在 `onlyBuiltDependencies`)

### 核心接口

**扩展 IR(`types.ts` 已有 `image_url` content part,但从未构造)**:

```typescript
// IRContentPart 第 69 行已定义 image_url,现在真正用起来:
export interface IRContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };   // url 可以是 data:base64 或 https:
}
```

**新建 `src/lib/multimodal/assemble.ts`**:

```typescript
/**
 * 把用户的文本 + 图片附件组装成 multimodal message。
 * 图片:小图(<256KB)用 base64 内联;大图走 /api/upload 后用可访问 URL。
 */
export async function buildMultimodalUserMessage(
  text: string,
  imageFileIds: string[],
  ctx: CallContext,
): Promise<IRMessage>;

/** 判断模型是否支持 vision(读 route.capabilities.vision)。 */
export function supportsVision(route: ResolvedRoute): boolean;
```

### 挂载点改造

**1. `/api/chat` route.ts** —— 在构造 `effectiveMessages` 前(第 95 行附近),分离 image 附件:

```typescript
const imageFileIds = fileIds.filter(id => 是图片);
if (imageFileIds.length > 0) {
  // 检查选定模型是否 vision 能力;非 vision 模型 + 图片 → 返回 400 "该模型不支持图片"
  const [modelRow] = await db.select().from(s.globalModels).where(eq(s.globalModels.name, body.model));
  if (!modelRow?.capabilities?.vision) {
    return NextResponse.json({ error: "当前模型不支持图片输入" }, { status: 400 });
  }
  // 把最后一条 user 消息升级为 multimodal
  const lastIdx = effectiveMessages.length - 1;
  effectiveMessages[lastIdx] = await buildMultimodalUserMessage(userContent, imageFileIds, ctx);
}
```

**2. `ChatComposer.tsx`** —— 第 251 行 textarea 新增 `onPaste` / `onDrop`:

```tsx
const handlePaste = useCallback((e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      // 复用现有 handleUpload 路径,但标记为 image
    }
  }
}, []);
```

附件区(第 469 行)对图片显示**缩略图预览**而非 paperclip 图标。

**3. 图片 URL 可访问性** —— vision 调用要求图片 URL 对上游 provider 可达。两条路径:

- 本地存储 + 公网部署:需经过鉴权代理,新建 `/api/files/{fileId}`(session 鉴权,流式返回)。但 OpenAI/Anthropic 服务器拉不到内网 URL —— 所以**生产模式必须用 base64 内联**,或走对象存储(P2-A)的公网 URL。
- 默认策略:图片统一 base64 内联(`sharp` 压缩到 ≤512KB 后内联),避开外网拉取问题。大图报错提示用户换对象存储。

### 降级

- 非 vision 模型收到图片附件 → 400 + 友好提示
- 图片超大 → 压缩失败 → 提示"图片过大,请压缩后上传"
- Anthropic 协议的 image 格式与 OpenAI 不同(AI SDK 内部已处理,`registry.ts` 第 47 行的 createAnthropic 会转换)

---

## P1-D — 图像生成 / 语音端点

### 设计目标

OpenAI 兼容生态除了 chat,还有 images / audio。补齐后 Nekusora 是完整的多模态网关。**这部分主要是网关扩展**,WebChat 侧只做轻量生成面板。

### 数据模型(扩展路由器)

图像生成和语音识别是**不同协议族**,不能塞进现有 `chat/completions` 路由。扩展 `globalRoutes` / `userModels` 的 `protocol` 枚举:

```typescript
// db/types.ts ProviderProtocol 扩展
export type ProviderProtocol =
  | "openai" | "anthropic" | "gemini" | "custom"
  | "openai-images"    // 新增:DALL-E / gpt-image 兼容
  | "openai-audio-stt" // 新增:Whisper 兼容
  | "openai-audio-tts";// 新增:TTS 兼容
```

`globalModels.capabilities` 扩展:

```typescript
export interface ModelCapabilities {
  stream?: boolean; tools?: boolean; vision?: boolean;
  systemPrompt?: boolean; reasoning?: boolean;
  // 新增:
  imageGeneration?: boolean;
  audioTranscription?: boolean;
  audioSynthesis?: boolean;
}
```

### 核心接口

**新建 `src/lib/providers/multimodal/`**:

```typescript
// image-gen.ts —— 复用四表路由器(resolveRoutes),但调 generateImage
import { generateImage } from "ai";

export async function generateImageViaRoute(
  route: ResolvedRoute, prompt: string, opts: ImageGenOpts
): Promise<{ images: { base64?: string; url?: string }[]; usage: IRUsage }>;

// audio-stt.ts —— transcribe
export async function transcribeViaRoute(
  route: ResolvedRoute, audioBuffer: Buffer, mime: string, language?: string
): Promise<{ text: string }>;

// audio-tts.ts —— synthesize
export async function synthesizeViaRoute(
  route: ResolvedRoute, text: string, voice?: string
): Promise<{ audioBuffer: Buffer; mime: string }>;
```

**路由器 `routing.ts` 改造** —— `resolveRoutes` 当前只认 chat 模型。新增一个并行入口 `resolveRoutesByCapability(ctx, capability)`:

- 查 `globalModels` WHERE `capabilities->>'imageGeneration' = 'true'` AND enabled
- 返回的 `ResolvedRoute` 仍走相同故障转移逻辑(复用 `stream.ts` 的 route 循环思想,但非流式)

### 新端点(全部 OpenAI 兼容格式)

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/v1/images/generations` | POST | Bearer sk | OpenAI Images API 格式,支持 `response_format=url` 走 P2-A 对象存储 |
| `/v1/audio/transcriptions` | POST | Bearer sk | multipart/form-data,Whisper 格式 |
| `/v1/audio/speech` | POST | Bearer sk | TTS,流式返回 audio stream |

**`response_format=url` 的处理**:生成的图片存到 StorageDriver(P2-A),返回公网 URL。`response_format=b64_json` 直接内联。这把 P1-D 和 P2-A 强绑定 —— 必须先有 P2-A 才能完整支持 url 模式。

### 挂载点

- 新建 `src/app/v1/images/generations/route.ts` / `audio/transcriptions/route.ts` / `audio/speech/route.ts`,结构对标 `v1/chat/completions/route.ts`(Bearer 鉴权 → verifyKey → resolveRoutes → 调适配器)
- 用量记录:`logUsage` 复用,`source="gateway"`,`model` 填模型名,token 字段对图片填 `0`(图片生成按张计费,后续 Billing 补)

### WebChat 侧(轻量)

`/chat` 新增 `/chat/generate` 子页:输入 prompt → 调 `/v1/images/generations`(用用户自己的 session key)→ 展示生成的图片网格。不做复杂编辑器。

### 降级

- 无对应能力的模型 → 路由器抛 `no_route`,端点返回 OpenAI 格式 error
- TTS 流式:AI SDK v5 的 `generateSpeech` 支持流式,直接 pipe 到 Response

---

## P2-A — 对象存储适配(StorageDriver 抽象)

### 设计目标

当前 `upload/route.ts` 第 40 行硬编码 `join(process.cwd(), "uploads", ...)`,`extract.ts` 用 `readFile` 直读本地路径。生产多实例部署时本地盘不可共享,且 vision/图像生成的 URL 模式需要公网可达。本项抽象出统一存储层,带降级。

### 数据模型(零新增,改字段语义)

`fileObjects.storagePath` 字段语义升级:从"本地绝对路径"改为**StorageDriver 无关的 key**:

- 旧:`/app/uploads/userId/fileId-name.png`(本地)
- 新:`userId/fileId-name.png`(key,各 driver 自行解释)

迁移:启动时检测 `storagePath` 以 `/` 或盘符开头的旧记录,自动视为 local driver 的绝对路径(向后兼容)。

### 核心接口

**新建 `src/lib/infra/storage/`**(对标 `db`/`cache`/`queue` 的降级基建风格):

```typescript
// driver.ts —— 统一接口
export interface StorageDriver {
  readonly kind: "local" | "s3" | "r2" | "minio";
  /** 上传(key 由调用方给,driver 负责存)。返回可访问的公开 URL(或 null=需鉴权代理)。 */
  put(key: string, data: Buffer, mime: string, opts?: PutOpts): Promise<StorageResult>;
  /** 读取为 Buffer。 */
  get(key: string): Promise<Buffer>;
  /** 删除。 */
  delete(key: string): Promise<void>;
  /** 生成预签名下载 URL(私有 bucket 临时访问)。 */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  /** 是否支持公网直链(决定 vision 调用走 url 还是 base64)。 */
  readonly publicReadable: boolean;
}

interface StorageResult { key: string; url: string | null; size: number; }
```

**driver 工厂** `src/lib/infra/storage/index.ts`(对标 `db/index.ts` 的方言工厂):

```typescript
/** 按 STORAGE_DRIVER 环境变量选 driver,惰性初始化。 */
export async function getStorage(): Promise<StorageDriver>;

// 选择逻辑(降级链):
// 1. STORAGE_DRIVER=s3 + AWS_S3_* 配置 → S3Driver
// 2. STORAGE_DRIVER=r2 + 配置 → R2Driver(Cloudflare R2,S3 兼容协议,复用 S3Driver 改 endpoint)
// 3. STORAGE_DRIVER=minio + 配置 → MinIODriver(同 S3 协议)
// 4. 默认 → LocalDriver(写 ./uploads,与现状 100% 兼容)
```

`S3Driver` / `R2Driver` / `MinIODriver` 都基于 `@aws-sdk/client-s3`(R2 和 MinIO 是 S3 兼容,改 endpoint 即可),所以**一个实现类**配不同 endpoint。

### 挂载点改造(精确)

| 文件 | 当前 | 改造 |
|---|---|---|
| `upload/route.ts:40-44` | `writeFile(join(...))` | `storage.put(key, buf, mime)`;`storagePath` 字段存 key |
| `rag/extract.ts:9,45` | `readFile(filePath)` | `storage.get(key)` → buffer → 解析 |
| `rag/process.ts:18` | `processFile(fileId, storagePath, mime)` | 改为 `processFile(fileId, key, mime)`,内部用 `storage.get` |
| `rag/retrieve.ts` | 无直接存储访问 | 不变 |
| P1-D image-gen | — | `storage.put` 存生成图,返回 url |
| P1-C vision | — | 检查 `storage.publicReadable`,决定 base64 内联还是传 url |

新增 `src/app/api/files/[fileId]/route.ts`:

- session 鉴权 + 校验文件属主
- 调 `storage.get` 流式返回(或 `signedUrl` 302 重定向,私有 bucket 场景)

### 环境变量(.env.example 增量)

```bash
# --- 对象存储(留空用本地磁盘,与现状兼容) ---
STORAGE_DRIVER=""              # "" | "s3" | "r2" | "minio"
# S3/R2/MinIO 共用(S3 协议):
S3_ENDPOINT=""                 # R2: https://<account>.r2.cloudflaretunnel.com
S3_REGION="auto"               # R2 用 "auto"
S3_BUCKET=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
S3_PUBLIC_BASE_URL=""          # 公网直链前缀(配 CDN 时填);空=走 signedUrl
```

### 降级

- driver 初始化失败(配错 key)→ 自动 fallback LocalDriver + 启动日志 WARN
- `put` 失败 → 上传端点返回 500,文件记录标 `processingStatus="storage_error"`
- Local driver 是永远可用的兜底,保证零配置开箱即用(与项目"零依赖本地开发"原则一致)

---

## P2-B — Prompt 库 / Agent 模板

### 设计目标

当前 system prompt 散落在 `globalModels.systemPrompt`(模型级)和 `conversationProjects.systemPrompt`(会话级),用户无法保存/复用自定义 prompt。本项做**可分享的 prompt 模板 + 可执行的多步 Agent**。

### 数据模型(新增 2 表)

```typescript
// prompt_templates —— 可复用的提示词模板
export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey().default(uuid),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }), // null=官方内置
  scope: text("scope").notNull(),          // "builtin" | "private" | "shared"
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),              // "writing" | "coding" | "analysis" | ...
  icon: text("icon"),
  systemPrompt: text("system_prompt"),     // 注入到 SlotSystemPrompt
  userTemplate: text("user_template"),     // 含 {{var}} 占位符的 user 模板
  variables: text("variables", { mode: "json" }).$type<TemplateVariable[]>(),
  recommendedModel: text("recommended_model"),
  isAgent: integer("is_agent", { mode: "boolean" }).notNull().default(false),
  agentConfig: text("agent_config", { mode: "json" }).$type<AgentConfig>(),  // isAgent=true 时
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  useCount: integer("use_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

interface TemplateVariable {
  name: string;            // "language"
  label: string;           // "目标语言"
  type: "text" | "select" | "textarea";
  required: boolean;
  default?: string;
  options?: string[];      // type=select
}

interface AgentConfig {
  maxSteps: number;             // agent 循环最大轮数
  allowedTools: string[];       // 允许的 MCP 工具名("web_search" 等)
  allowedServers: string[];     // mcp_servers id
  stopCondition?: string;       // "no_more_tool_calls" | "task_complete_keyword"
}
```

### 核心接口

**新建 `src/lib/templates/service.ts`**:

```typescript
/** 列出用户可见模板(builtin + 自己 private + 他人 shared)。 */
export async function listTemplates(ctx: CallContext, opts?: { category?: string }): Promise<Template[]>;

/** 渲染模板:把 variables 填入 userTemplate,返回最终 system + 首条 user 消息。 */
export function renderTemplate(
  template: PromptTemplate,
  variables: Record<string, string>,
): { systemPrompt: string; userMessage: string };

/** 实例化一个 Agent(isAgent=true):返回带 tools + maxSteps 的 IRRequest。 */
export async function instantiateAgent(
  ctx: CallContext,
  templateId: string,
  variables: Record<string, string>,
): Promise<{ irRequest: IRRequest; agentConfig: AgentConfig }>;
```

### 挂载点

**1. `context-assembler.ts`** —— 新增 `SlotTemplate`:

```typescript
// assembleContext 第 35 行 slots 数组,在 SlotSystemPrompt 之后:
if (input.templateSystemPrompt) {
  slots.push(input.templateSystemPrompt);   // 模板 system 覆盖模型默认
}
```

**2. P1-A 的 agent loop 复用** —— `streamChatWithTools` 的 `maxSteps` / `tools` 来自 `agentConfig`,这就是 Agent 模板的执行引擎。Prompt 模板(非 agent)走普通 streamChat;Agent 模板走 streamChatWithTools。

**3. 新建会话时选模板**:

```
/chat 新建会话按钮 → 弹出模板选择器:
  [空白对话]
  [📝 翻译助手]  variables: { language }
  [💻 代码审查]  variables: { language, framework }
  [🤖 研究助手]  (Agent: 可调 web_search, maxSteps=10)
```

选定后:`conversation.projectId` 关联(可复用 `conversationProjects`),`userTemplate` 的变量表单动态渲染。

### UI

- `/panel/templates` 用户面板页:CRUD 自己的模板(对标 `/panel/providers` 结构)
- `/admin/templates` 管理员页:管理 builtin / shared 模板
- `/chat` 顶部模板选择器 + 变量表单弹层

### 种子数据

内置 5-8 个高质量模板:翻译、代码审查、会议纪要、SQL 生成、研究助手(agent)等。用 seed 脚本插入(`scope="builtin"`, `userId=null`)。

---

## P2-C — 运维监控(healthz / metrics / 图表)

### 设计目标

当前零运维端点。`instrumentation.ts` 只打了一行日志。补齐:存活/就绪探针、Prometheus metrics、admin 用量图表(复用 `usageLogs` 数据)。

### 数据模型(零新增)

完全基于现有 `usageLogs` + `runs` + `fileObjects` 表聚合。

### 核心接口

**1. 健康检查端点**(新建 `src/app/healthz/`):

```typescript
// /healthz        —— 存活探针(liveness),只要进程在就 200
export async function GET() {
  return Response.json({ status: "ok", uptime: process.uptime() });
}

// /healthz/ready  —— 就绪探针(readiness),检查 DB + 关键依赖
export async function GET() {
  const checks = await runChecks({
    db: async () => { const db = await getDb(); await db.execute("select 1"); return "ok"; },
    storage: async () => { const s = await getStorage(); return s.kind; },
    queue: async () => ({ available: await queueAvailable() }),
    redis: () => Promise.resolve(!!process.env.REDIS_URL),
  });
  const ok = Object.values(checks).every(v => v !== "error");
  return Response.json({ status: ok ? "ready" : "degraded", checks }, { status: ok ? 200 : 503 });
}
```

**2. Prometheus metrics** —— `/metrics`(新建):

```typescript
// 用 prom-client(轻量,~50KB)
import { Registry, Gauge, Counter, Histogram } from "prom-client";

// 关键指标(全部从 usageLogs 聚合,或 streamChat/usage.ts 实时埋点):
const requestTotal = new Counter({ name: "nekusora_requests_total",
  help: "Total requests", labelNames: ["source", "model", "status"] });
const tokensTotal = new Counter({ name: "nekusora_tokens_total",
  help: "Tokens used", labelNames: ["type", "model"] });  // type: prompt|completion
const latencyHist = new Histogram({ name: "nekusora_request_duration_ms",
  help: "Request latency", buckets: [100,500,1000,3000,10000,30000] });
const activeStreams = new Gauge({ name: "nekusora_active_streams",
  help: "Active streaming connections" });
```

**挂载点**:在 `usage.ts` 的 `logUsage`(第 27 行 insert 后)埋 `requestTotal.inc()` / `tokensTotal.inc()`;在 `stream.ts` 进入 streamChat 时 `activeStreams.inc()`,finally 时 `activeStreams.dec()` + `latencyHist.observe()`。这样**不改业务逻辑**就能采全数据。

**3. Admin 用量图表**(扩展 `/admin/usage`):

当前 `admin/usage/page.tsx` 是静态表格。升级为时间序列图表:

- 用 `recharts`(P1-B 也需要图表能力,共用)
- 数据源:对 `usageLogs` 按小时/天聚合(GROUP BY date_trunc / strftime)
- 三张图:
  1. **请求量趋势**(按 source:chat vs gateway,堆叠面积图)
  2. **Token 消耗**(prompt vs completion,按模型分组柱状图)
  3. **模型调用分布**(饼图,按 model)
- 顶部筛选:时间范围(24h / 7d / 30d)、模型、用户

**4. `/admin/operations` 新页**(对标现有 admin 页结构):

- 实时面板:当前 active streams、各 provider 健康状态(最近 100 次调用成功率/延迟)
- 系统信息:DB dialect、Redis 状态、队列深度、StorageDriver 类型(全部来自 `getEnvInfo()` 扩展)
- 队列积压:查 pg-boss 表(PG 模式),显示未消费任务数

### 降级

- `/metrics` 在 SQLite 模式依然可用(数据来自内存 counter,不依赖 PG 聚合)
- 图表聚合查询在 SQLite 用 `strftime`,PG 用 `date_trunc` —— dialect 差异已在 `db/index.ts` 隔离,聚合 SQL 用条件分支
- pg-boss 队列深度仅 PG 模式显示,SQLite 模式显示 "N/A(单进程模式)"

---

## 汇总:交叉影响、迁移路径、分阶段路线图

### 交叉依赖矩阵

| | P1-A | P1-B | P1-C | P1-D | P2-A | P2-B | P2-C |
|---|---|---|---|---|---|---|---|
| **P1-A** | — | | | | | ✓(agent loop) | |
| **P1-B** | | — | | | | | |
| **P1-C** | | | — | | ✓(URL 可达) | | |
| **P1-D** | | ✓ | | ←←← | ✓(url 模式必需) | | |
| **P2-A** | ✓ | ✓ | ←←← | ←←← | — | | |
| **P2-B** | ✓(agent) | | | | | — | |
| **P2-C** | | | | | | | — |

**强依赖**:

- P1-D 的 image generation `response_format=url` **必需** P2-A
- P1-C vision 大图 **推荐** P2-A(否则只能 base64 内联)
- P2-B Agent 模板 **必需** P1-A 的 agent loop
- P2-C metrics 复用 P1-A 的 toolCalls 数据(工具调用指标)

### 数据库迁移影响

| 项 | 新表 | 改字段 | 迁移风险 |
|---|---|---|---|
| P1-A | mcp_servers | — | 低(纯新增) |
| P1-B | artifacts | messages.content 语义扩展 | 中(需保留旧 text 记录兼容) |
| P1-C | — | fileObjects(无改动) | 无 |
| P1-D | — | ProviderProtocol 枚举扩展 | 低(向后兼容,新值不影响旧路由) |
| P2-A | — | fileObjects.storagePath 语义 | 低(启动时自动兼容旧路径) |
| P2-B | prompt_templates | — | 低(纯新增) |
| P2-C | — | — | 无 |

全部为**增量迁移**,无需停机。schema 改完跑 `pnpm db:generate:{pg,sqlite}` + migrate。

### 依赖增量

| 包 | 用途 | 体积 | 必需项 |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | P1-A MCP | ~200KB | P1-A |
| `mermaid` | P1-B 图表渲染 | ~1.2MB(动态 import) | P1-B |
| `katex` | P1-B 公式 | ~270KB | P1-B |
| `sharp` | P1-C 图片压缩 | 已在 onlyBuiltDependencies | P1-C |
| `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | P2-A 对象存储 | ~500KB(动态 import) | P2-A |
| `recharts` | P2-C 图表(也服务 P1-B 非代码渲染) | ~400KB | P2-C |
| `prom-client` | P2-C metrics | ~50KB | P2-C |

所有大包都用动态 import 隔离 bundle,符合项目现有 Turbopack 降级模式(参考 `queue.ts` 对 pg-boss 的处理)。

### 推荐实施顺序(4 个阶段)

**阶段 1(基建先行,无 UI 依赖)**:

1. **P2-A 对象存储** —— 解锁 P1-C/P1-D 的 URL 模式,改动集中在 infra 层
2. **P2-C 运维监控** —— 纯增量,不影响现有功能,先建好可观测性

**阶段 2(网关能力扩展)**:

3. **P1-D 图像/语音端点** —— 依赖 P2-A,纯后端,价值密度高
4. **P1-C 多模态上传** —— 依赖 P2-A(vision URL),前端改动适中

**阶段 3(AI 工作台深化)**:

5. **P1-A MCP 双向** —— 最大单项,解锁 agent 能力
6. **P2-B Prompt 库 / Agent** —— 依赖 P1-A 的 agent loop,完整闭环

**阶段 4(体验)**:

7. **P1-B Artifact 面板** —— 纯前端体验提升,独立可并行

### 环境变量增量汇总(最终 .env.example 新增段)

```bash
# --- MCP (P1-A) ---
MCP_CONNECT_TIMEOUT_MS="500"
MCP_TOOL_CACHE_TTL_SECONDS="300"

# --- 对象存储 (P2-A) ---
STORAGE_DRIVER=""
S3_ENDPOINT=""
S3_REGION="auto"
S3_BUCKET=""
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
S3_PUBLIC_BASE_URL=""

# --- 监控 (P2-C) ---
METRICS_ENABLED="true"
METRICS_PATH="/metrics"
```

---

## 三项关键决策(已确认)

| 决策点 | 选择 | 影响 |
|---|---|---|
| 实施顺序 | **基建先行** | P2-A → P2-C → P1-D → P1-C → P1-A → P2-B → P1-B |
| MCP 方向 | **双向同步** | P1-A Host + Server 端点 `/v1/mcp` 同步交付 |
| Artifact 触发 | **自动检测代码块** | `extractArtifacts` 基于 ``` 围栏解析,零配置 |
