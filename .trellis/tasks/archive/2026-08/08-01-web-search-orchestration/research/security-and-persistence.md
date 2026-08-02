# 安全、迁移与持久化研究

## 密钥

- 搜索 key 当前明文存于 `user_settings.value`，且完整配置进入 Client Component props。
- 项目已有 AES-256-GCM `encrypt/decrypt` 与 Provider key bundle 模式，应复用而非新增加密算法。
- SQL 迁移无法独立获得 `DATA_ENCRYPTION_KEY`，因此历史明文需要应用级 backfill；仅懒迁移会让长期不活跃用户继续保留明文，不满足收口目标。
- 推荐发布顺序：V2 双读/密文单写 -> backfill/dry-run -> 零明文校验 -> 删除 V1 明文读取。

## SearXNG SSRF

- 仅 `new URL()` 和保存时 DNS 检查不足以防 DNS rebinding。
- 安全请求必须验证所有 A/AAAA，并确保实际连接使用已验证地址；重定向每一跳重复校验。
- 拒绝范围至少包含 loopback、RFC1918、CGNAT、link-local、IPv6 unique-local、multicast、unspecified、保留地址和 metadata endpoint。
- 允许公网 HTTP/HTTPS；HTTP 到 HTTPS 的合法跳转通过手动有限重定向支持。

## 结果内容

- Provider JSON 是外部不可信输入，先 Zod 校验再进入领域层。
- URL 仅允许 HTTP/HTTPS、不得含凭据，规范化后按 URL 去重。
- title/snippet 限长，搜索片段在模型上下文中标记为不可信资料，不能覆盖系统指令。
- query 不进入普通日志或 metrics label；错误响应使用稳定分类，不回显内部网络目标和堆栈。

## 持久化

- `messages.processTrace` JSONB 已随 assistant completion 事务写入，适合保存每次搜索调用。
- `runs` 继续作为 run 状态/用量事实源，不把模型/usage 重复复制到 message。
- 历史和版本恢复需从目标 assistant 的 trace 投影，不能继续依赖当前 Zustand 临时结果。
- 搜索可以多次调用，trace 应保存 `calls[]` 而非单个 query 字段。
