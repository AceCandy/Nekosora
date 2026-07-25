# 后台任务模型配置与 Chat 完成时序优化 Design

## 1. 核心结论

本任务采用“主回答只等待必要持久化，后台智能任务独立执行”的边界：

```text
/api/chat 主链路
  user 消息落库
  -> 提交标题任务(只入队,不等模型)
  -> 流式生成 assistant
  -> 记录主回复用量
  -> assistant 消息/Artifact/generating=false 持久化
  -> 发送 [DONE] 并关闭 SSE

worker 后台链路
  conversation-title -> 调标题模型 -> 条件更新 conversations.title
  memory-extract     -> 调 Mem0 LLM -> 抽取 project 记忆
```

标题、摘要、Mem0 LLM 都从 Nekosora 已配置模型中选择。Mem0 不再复用 Embedding Provider 的 LLM 连接；Embedding Provider 只负责向量化。

## 2. 当前证据

- `route.ts:316-417` 先发送 `[DONE]`，再同步保存 assistant、Artifact、`generating=false`，并 `await maybeGenerateTitle()` 后才 `controller.close()`。
- `sse.ts:83-96` 当前忽略 `[DONE]`，前端只有等 reader EOF 才结束 `streaming`。
- `conversation-title/service.ts:46-103` 标题只依赖首条 user 消息，先写 fallback，再调用 `generateChat(... taskKind:"title")` 生成最终标题。
- `compact/service.ts:55-68` 摘要模型已有 `task.compact_model` 配置回退。
- `memory/mem0.ts:27-60` 当前 Mem0 LLM 复用 embedding 上游连接，仅替换模型名，导致只能选择 embedding 上游可用的 chat 模型。
- `mem0ai/oss` 的 `MemoryConfig` 将 `embedder` 与 `llm` 分离；Mem0 抽取调用 `llm.generateResponse(..., { type:"json_object" })`。
- `/v1/chat/completions` 是 OpenAI 兼容网关，但内部后台任务不应为调用自身再造 API Key、HTTP 回环或重复记外部网关日志。

## 3. 设计边界

### 3.1 Chat 完成信号

`[DONE]` 改为可靠完成信号：只有当本轮 assistant 已落库、Artifact 已完成必要保存、`conversations.generating=false` 已写入后才发送。前端收到 `[DONE]` 后可以安全结束 `streaming`，不用等待网络 EOF。

推荐调整：

1. `route.ts` 生成循环结束后不要立即发 `[DONE]`。
2. `finally` 先完成必要持久化。
3. 最后 `safeEnqueue("data: [DONE]\n\n")`，随后 `controller.close()`。
4. `consumeChatSSE` 在读到 `[DONE]` 时立即 return，并在 finally release reader。

不要让 `[DONE]` 早于 assistant 落库，否则重试、删除、续写等依赖 publicId 查 DB 的操作会竞态失败。

### 3.2 标题后台任务

新增 pg-boss 队列名：`conversation-title`。

Payload 建议：

```typescript
interface ConversationTitleJob {
  userId: string;
  conversationId: string;
  firstUserMessage: string;
  fallbackTitle: string;
}
```

Chat 路由在新 user 消息插入后：

- 若会话标题仍为“新会话”，同步写 fallback 标题。
- 入队 `conversation-title`。
- 不向当前 SSE 推送 `title_updated`，不 `await` 模型生成。

Worker 消费后调用标题服务生成最终标题，并条件更新：

```sql
UPDATE conversations
SET title = :title
WHERE id = :conversationId
  AND user_id = :userId
  AND title IN ('新会话', :fallbackTitle)
```

这样用户手动改名不会被迟到后台任务覆盖。标题生成失败静默保留 fallback。

### 3.3 后台模型配置

保留旧键兼容，但新增模型 ID 键作为主路径：

| 任务 | 新设置键 | 旧兼容键 | 调用方式 |
|---|---|---|---|
| 标题 | `task.title_model_id` | `task.title_model` | `generateChat(... modelId)` |
| 摘要 | `task.compact_model_id` | `task.compact_model` | `streamChat(... modelId)` |
| Mem0 LLM | `rag.mem0_llm_model_id` | `rag.mem0_llm_model` | 新统一 LLM 适配器 |

设置页 UI 使用下拉/选择器，不再让管理员手输模型名。候选模型应来自：`models.enabled=true AND visibility='public'`，并且至少有一条 enabled route + enabled provider。展示用 `displayName ?? name`，保存用 `id`。

旧键兼容策略：

- 若新 ID 键存在，优先 byId。
- 若不存在但旧 name 键存在，按现有 byName 逻辑回退。
- 保存新 UI 时写新 ID 键；可以同时删除或保留旧 name 键。推荐清空对应旧键，减少歧义。

运行时回退顺序：

- 标题：配置 ID -> 旧 name -> 本次会话模型 ID/name。
- 摘要：配置 ID -> 旧 name -> 第一个 public+enabled+可路由模型。
- Mem0：配置 ID -> 旧 name 对应的 public 模型 -> 标题配置 ID -> 静默跳过。

### 3.4 Mem0 使用统一模型执行核心

不要让 Mem0 HTTP 调 `/v1/chat/completions`。原因：

- 需要内部 API Key 的生命周期管理，且明文只创建时可见。
- 会多走 HTTP 回环、鉴权、lastUsedAt 更新。
- `source` 会变成 `gateway`，污染外部网关用量口径。
- 现有 `/v1/chat/completions` 没显式透传 `response_format`，而 Mem0 抽取依赖 `{ type:"json_object" }`。

新增内部适配层 `src/lib/memory/nekosora-llm.ts`，通过 Mem0 官方支持的
`llm.provider="langchain"` 接入一个带 `invoke()` 的轻量模型对象：

```typescript
const memoryChatModel = {
  modelId,
  response_format: true,
  async invoke(messages, options) {
    const result = await generateChat({
      ctx: { userId: "", keyKind: null, source: "chat" },
      modelId,
      taskKind: "memory",
      request: { model: modelName, messages: toIR(messages), stream: false },
      output: options?.response_format?.type === "json_object" ? "json" : "text",
    });
    if (result.error) throw new Error(result.error);
    return { content: result.text, role: "assistant" };
  },
};
```

`MemoryConfig.llm` 仍使用公开稳定配置，不 monkey-patch Mem0 实例：

```typescript
llm: {
  provider: "langchain",
  config: { model: memoryChatModel },
}
```

同时扩展 `generateChat`：支持 `modelId` 分流到 `resolveRoutesById`，并在
`output="json"` 时给 AI SDK `generateText` 传 `Output.json()`。Mem0 的
`{ type:"json_object" }` 因此可以跨 OpenAI、Anthropic、Gemini 等协议走统一
结构化输出语义，而不依赖 `/v1` HTTP 或某个上游兼容格式。

Mem0 是系统后台任务，统一执行核心使用空 `userId`，使 `logUsage` 将用户归属
收敛为 `null`，并以 `taskKind="memory"` 记录；记忆本身仍按 `memory.add()` 的
真实 userId 隔离。候选模型只允许 public，空 userId 不会获得 private 模型。

### 3.5 Worker 配置刷新

管理端的 `resetTitleModelConfig()` / `resetMemoryClient()` 只能清理当前 Next.js
进程，不能跨进程通知 `src/worker.ts`。因此后台任务不能只依赖永久内存缓存：

- 标题 worker 每个任务读取当前模型 ID，不缓存设置值。
- `extractMemories` 在真正进入 Mem0 抽取前要求 `getMemory` 重新读取 LLM 模型
  设置；若模型 ID 与当前 client 指纹不同，重建该 Worker 进程内的 Mem0 client。
- 记忆召回/普通 CRUD 可以继续复用已建 client，不为每次 search 增加设置查询。
- 摘要在 Web 请求内运行，配置读取同样取消永久缓存，保证多实例部署下收敛。

### 3.6 摘要模型 byId

`compact/service.ts` 当前 `resolveCompactModel()` 返回 model name。调整为返回 `{ modelId?: string; modelName: string }`：

- 新键 `task.compact_model_id` 命中时查询模型 name，用 `streamChat({ modelId, request.model: modelName })`。
- 旧键 `task.compact_model` 命中时沿用 byName。
- 都为空时回退第一个 public+enabled+有路由模型，返回 id + name。

### 3.7 标题模型 byId

`conversation-title/service.ts` 拆分为两个层次：

- `writeFallbackTitle(...)`：只写 fallback + 条件保护。
- `generateConversationTitle(...)`：后台 worker 调用，读取 `task.title_model_id`，生成最终标题。

旧的 `maybeGenerateTitle` 可以保留为兼容 wrapper，但 `/api/chat` 不再调用它的模型生成路径。

### 3.8 UI 设计约束

`ModelConfigSection.tsx` 当前三个配置都是自由文本输入。改为一致的模型选择控件：

- 每个配置块仍保持现有 8px 圆角、1px 边框、静止无投影。
- 使用原生 `select` 或项目已有 `OptionPicker`，不要新增复杂弹窗。
- 字号使用 `text-ui-*`，颜色使用设计 token，不写裸 hex。
- 文案改为“选择已配置模型”，Mem0 说明改为“不再复用 embedding 上游；通过星枢模型路由执行记忆抽取”。
- 若无候选模型，显示内联提示并禁用保存按钮。

## 4. 风险与取舍

- 标题最终更新不实时推送。按用户确认，允许静默写库，下次刷新/导航同步。
- Worker 未运行时标题/记忆任务会堆积，但 Chat 主流程不受影响。队列可靠性依赖 pg-boss。
- Mem0 通过统一执行核心后，所有协议受益；必须补 `Output.json()` 透传测试，
  否则 JSON 抽取可能退化。
- 公共模型的可见性按 `resolveRoutesById` 语义；Mem0 系统调用使用空
  `ctx.userId` 并仅允许 public modelId。private 模型不作为全局后台候选，
  避免跨用户泄露。

## 5. 不做

- 不新增 WebSocket / 标题实时推送。
- 不改 Mem0 抽取 prompt、scope 策略、十分钟频率保护。
- 不重构模型目录或 Provider 协议体系。
- 不让 Worker 通过 HTTP 调用自己的 `/v1`。

## 6. 保存后选择值回退的回归修复

### 6.1 根因

三个后台模型选择器使用 Server Action 表单与非受控 `defaultValue`。React 19
在 Action 成功后自动 reset 表单，控件先回到挂载时的旧默认值；随后 RSC
虽然经 `revalidatePath` 读到新设置，但更新 `defaultValue` 不保证覆盖已挂载
控件的 current value，因此界面保持旧值，整页刷新重挂后才正确。

这与历史提交 `de0b526` 不同：历史问题是遗漏 `revalidatePath`；本次三个
Action 已正确 revalidate，问题位于客户端表单状态所有权。

### 6.2 修复边界

- 抽出一个 Client 模型配置表单，三个选择器统一使用受控
  `value + useState + onChange`，维持提交期间的交互状态。
- Server Component 继续负责候选查询、鉴权、模型可路由校验、写库与
  `revalidatePath`，不把服务端数据访问移到客户端。
- 调用方以服务端已保存模型 ID 作为组件 key；Action 写库并 revalidate 后，
  RSC 返回不同 key，强制重建 DOM 与本地 state。仅受控 `value` 仍可能被
  React 的原生 form reset 直接改写 DOM，不能省略 key 收敛。
- `useClickOutside` 的最新回调 ref 在 effect 中同步，禁止 render 阶段写
  `ref.current`；事件监听和 Portal 排除语义保持不变。

### 6.3 验收

- 标题、摘要、Mem0 任一选择器保存后保持所选值，无需手动刷新。
- 清空为自动模式后同样保持空值。
- 刷新页面后值与数据库一致。
- `pnpm check` 不再被 `useClickOutside` 的 `react-hooks/refs` 阻断。
