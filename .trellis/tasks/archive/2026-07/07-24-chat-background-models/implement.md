# 后台任务模型配置与 Chat 完成时序优化 Implement Plan

## 1. 准备

- 读取本任务 `prd.md`、`design.md`。
- 读取 `.trellis/spec/backend/{directory-structure,database-guidelines,gateway-routing,memory-system}.md`。
- 读取 `.trellis/spec/frontend/{component-guidelines,quality-guidelines,type-safety}.md`。
- 注意工作树已有用户改动，修改前先看目标文件当前 diff，不覆盖无关改动。

## 2. 实施步骤

### Step A: 配置模型选择数据源

1. 新增服务端 helper，列出 `public + enabled + 有 enabled route + enabled provider` 的模型候选。
2. `ModelConfigSection.tsx` 读取候选，三个配置项保存模型 ID：
   - `task.title_model_id`
   - `task.compact_model_id`
   - `rag.mem0_llm_model_id`
3. 保存后清除对应缓存：标题、摘要、Mem0 client。
4. 更新中英文 i18n 文案，移除“手输模型名 / 复用 embedding 上游”的表述。

验证：设置页无候选、已选候选、清空配置三种状态可渲染；无裸 hex/字号任意值新增。

### Step B: 标题服务后台化

1. 在 `conversation-title/service.ts` 中拆出：
   - fallback 标题生成/写入函数。
   - 后台最终标题生成函数。
   - 配置解析函数，优先 ID，兼容旧 name。
2. `/api/chat/route.ts` 在新 user 消息落库后同步写 fallback，并入队 `conversation-title`。
3. `src/worker.ts` 注册 `conversation-title` handler。
4. 移除 `/api/chat` 收尾中的 `await maybeGenerateTitle(...)`。

验证：标题最终生成失败不影响 Chat；用户改名后条件更新不覆盖。

### Step C: Chat SSE 完成时序

1. `/api/chat/route.ts` 生成循环结束后不立即发 `[DONE]`。
2. finally 中先保存 assistant/update continue、Artifact、`generating=false`、记忆入队。
3. 最后发送 `[DONE]` 并关闭 controller。
4. `consumeChatSSE` 读到 `[DONE]` 后立即 return。

验证：`[DONE]` 之后前端 `streaming=false`；assistant publicId 已落库可查。

### Step D: 摘要模型 byId

1. `compact/service.ts` 解析 `task.compact_model_id`，返回 modelId + modelName。
2. 调 `streamChat` 时传 `modelId`，`request.model` 仍为可读 model name。
3. 保留旧 `task.compact_model` 回退。

验证：单测覆盖 ID 优先、旧 name 回退、无配置回退 public model。

### Step E: Mem0 LLM 改为 Nekosora 统一执行核心

1. 新增内部 LLM 适配器：不要 HTTP 调 `/v1`。
2. `memory/mem0.ts` 中 embedder 继续用 `rag.embedding_*`；llm 固定改为
   Mem0 官方 `langchain` provider，`config.model` 传带 `invoke()` 的适配器。
3. 适配器内部调用 `generateChat`/统一核心：
   - `ctx: { userId:"", keyKind:null, source:"chat" }`
   - `taskKind:"memory"`
   - `modelId` 来自 `rag.mem0_llm_model_id`
   - 兼容旧 `rag.mem0_llm_model` name
   - 把 `response_format:{type:"json_object"}` 映射为 `generateChat output="json"`
4. 如果没有有效模型配置，`getMemory()` 初始化失败；`extractMemories` 继续 catch 静默。
5. 抽取路径每次核对当前 LLM 模型设置；设置指纹变化时重建 Worker 内的
   Mem0 client，召回/CRUD 路径仍复用 client。

验证：Mem0 不再读取 embedding provider 的 chat 模型；LLM 调用可命中非 OpenAI 上游路线。

### Step F: response_format 透传

1. 给 `generateChat` 增加最小的 `output?: "text" | "json"` 选项。
2. `output="json"` 时给 AI SDK `generateText` 传 `Output.json()`。
3. `generateChat` 同时修正 `modelId` 分流，行为与 `streamChat` 对齐。

验证：新增测试断言 Mem0/Nekosora LLM 对 `json_object` 传递到生成核心。

## 3. 测试计划

优先定向测试：

```bash
pnpm test src/features/chat/model/sse.test.ts
pnpm test src/lib/conversation-title/service.test.ts
pnpm test src/lib/compact/service.test.ts
pnpm test src/lib/memory/extract.test.ts
pnpm test src/lib/memory/mem0.test.ts
pnpm test src/lib/stream-circuit-breaker.test.ts
```

最终质量门槛：

```bash
pnpm check
pnpm test
```

若 JavaScript/TypeScript 测试环境因外部服务或 DB 环境缺失失败，记录真实错误和未验证项。

## 4. 回滚点

- 若 Mem0 适配器接入风险过高，可先保留旧 `rag.mem0_llm_model` 行为，但 UI 不应宣称支持任意 Nekosora 模型。
- 若 `[DONE]` 提前结束导致操作竞态，回退前端对 `[DONE]` 的立即 return，保留服务端顺序修复。
- 若标题 worker 有问题，可保留 fallback 标题，不恢复主链路同步等待。

## 5. 回归修复：设置表单状态与 Hook lint

1. 新增 Client 受控模型选择表单，复用到标题、摘要、Mem0 三项；Server
   Action、候选过滤和 `revalidatePath` 继续留在 `ModelConfigSection.tsx`。
2. 以服务端已保存 ID 作为组件 key，使 RSC 新值与本地 state 收敛。
3. 将 `useClickOutside` 的回调 ref 更新移入 effect，保持事件语义不变。
4. 运行改动文件 ESLint、`pnpm typecheck`、`pnpm test`、`pnpm check`；有登录
   条件时用浏览器验证选择、保存、自动模式和刷新后的值。
