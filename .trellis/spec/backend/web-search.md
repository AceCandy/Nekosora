# Web Search Guidelines

> Nekusora 联网搜索配置契约。权威实现：`src/lib/web-search/registry.ts`、`src/lib/web-search/types.ts`、`src/app/(dash)/panel/web-search/page.tsx`。

---

## per-user 配置(非系统级)

联网搜索是**个人配置**,不进 admin 系统设置。配置存 `user_settings` 表,`key = "web_search"`,`value` 为 JSON:

```ts
WebSearchConfig = { version: 1, providers: WebSearchProviderConfig[] }
WebSearchProviderConfig = { id, type, name, apiKey?, model?, baseUrl?, enabled }
```

- 读取/写入统一走 `registry.ts`:`loadConfig(userId)` / `saveWebSearchConfig(userId, config)`。
- `saveWebSearchConfig` 用 drizzle `onConflictDoUpdate(target: [userId, key])` upsert,并清该用户缓存。
- 不要在路由层或前端另写一份配置读取;新增 provider 类型只在 `buildProvider` switch 与 `types.ts` 扩展。

---

## 生效语义:首个 enabled

`resolveProvider(userId)` 取 `providers` 中**首个 `enabled`** 的构造实例。多 provider 仅作备份,启停切换即换源,无权重/轮询。

`buildProvider` 校验必填字段,缺失返回 `null`(视为未启用):
- `tavily` / `bocha` / `zhipu` 需 `apiKey`;`zhipu` 可选 `model`(默认 glm-4-plus)。
- `searxng` 为自建实例,需 `baseUrl`,无 `apiKey`。

---

## 缓存

registry 内 per-user 缓存(`Map<userId, {config, ts}>`,60s TTL)。`saveWebSearchConfig` 写后主动 `clearWebSearchConfigCache(userId)`。`service.searchWeb` 另有 query 级缓存,key 含 `userId` 隔离。

---

## 调用方

`orchestrator.ts` 按 `userId` 调 `searchWeb(userId, query)`;未配置或无 enabled 返回 `hit:false`,不阻断主对话流。
