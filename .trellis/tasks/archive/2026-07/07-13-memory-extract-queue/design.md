# Design:记忆提取搬入 pg-boss 队列

## 现状与目标

- 入队点:`src/app/api/chat/route.ts:343-346` 当前 `extractMemories(...).catch(() => {})`(同进程 fire-and-forget)。
- 消费点:`src/worker.ts` 现仅注册 `file-process`。
- 目标:主进程入队 → worker 消费,复用 pg-boss,不引入新中间件。

## job data 契约

```ts
type MemoryExtractJob = {
  userId: string;
  conversationId: string;
  recentMessages: { role: string; content: string }[];
  model?: string;
};
```

全部字段可序列化(extractMemories 入参本身即是),无函数 / 请求对象 / 不可序列化上下文。

## 入队点改造(route.ts)

收尾副作用块改为:

```ts
if (assistantText && !isContinue) {
  const recentMessages = [...].map(...);  // 保持现有构造
  getQueue()
    .then((q) => q.send("memory-extract", { userId: user.id, conversationId: body.conversationId, recentMessages, model: body.model }))
    .catch(() => {});  // 入队失败静默,不阻断响应
}
```

- 不 `await`(保持 fire-and-forget,响应不被队列写入延迟)。
- `recentMessages` 构造逻辑与原调用完全一致(含 `[...body.messages, { role:"assistant", content: assistantText }]` 与 content 字符串化)。

## worker handler(worker.ts)

在 `file-process` handler 之后增加:

```ts
await queue.work<MemoryExtractJob>("memory-extract", async (data) => {
  console.log("[worker] memory-extract:", data.userId);
  await extractMemories(data.userId, data.conversationId, data.recentMessages, data.model);
});
```

- 直接复用 `extractMemories`,其内部已大量 catch(失败静默),handler 不额外包 try/catch。
- 若 `extractMemories` 仍抛致命错(如 DB 断连),pg-boss 把该 job 标记失败(按其重试/归档策略处理),不影响 `file-process` 或其他 job。

## 频率保护跨进程(关键)

`extractMemories` 内部现有逻辑:
- 入口 `cacheWrap("memextract:${userId}", () => false, 600_000)` —— 占位写 false
- 末尾 `cacheSet("memextract:${userId}", true, 600_000)` —— 标记已提取

跨进程表现:
- **配 Redis**:cache 跨进程共享,worker 侧频率保护天然生效 ✓
- **不配 Redis(内存 cache)**:worker 进程 cache 独立于主进程;但因入队方是主进程、消费方是 worker 同一进程,worker 进程内 cache 对其连续消费的多个 job 仍有效 → 10 分钟内只真正提取一次 ✓

**结论:不引入主进程预检,完全依赖 worker 侧 extractMemories 内部频率保护。** 代价是重复对话会重复入队、worker 拉取后命中频率保护跳过(开销仅为轻量 pgboss 行 + cache 查询),按 YAGNI 接受。若后续压测显示入队开销显著,再加主进程 `cacheGet` 预检(配 Redis 时跨进程有效)。

## 与 file-process 共存

- worker.ts 同时注册 `file-process` + `memory-extract` 两个 handler。
- pg-boss 每个 queue name 独立轮询,两类 job 并行消费,互不阻塞。
- 单 job 失败隔离:pg-boss 的失败 job 机制保证一个 job 的异常不影响其他 job。

## 不改的部分

- `extractMemories` 内部逻辑不动(LLM prompt / parse / 去重 / 写库 / cache 失效)。
- 触发时机不变(仍在对话流结束的 finally 块)。
- 不引入 BullMQ / Redis 队列。
- 不改 `extractMemories` 签名。
