# 依赖审计与安全升级设计

## Boundaries

本次只修改根依赖清单、pnpm 锁文件及 Trellis 任务记录。升级按风险分层：同主版本更新直接应用；漏洞修复所需的跨主版本或 pre-1.0 次版本，在确认现有导入/API 兼容后应用；其余主版本只做审计记录。

## Upgrade Strategy

1. 使用显式 `pnpm up <name>@<version>` 更新选定直接依赖，避免无边界的 `--latest`。
2. Drizzle ORM 与 Kit 同批升级，防止 ORM/CLI 版本漂移；通过类型检查和现有数据库相关测试验证调用兼容性，不生成迁移。
3. `react-syntax-highlighter@16.1.1` 保留现有 Prism 导入方式，并通过类型检查和测试验证。
4. 对 Next 固定的旧 PostCSS 使用 `pnpm.overrides` 的 `next>postcss` 定向规则，不影响 Tailwind/Vite 等其他 PostCSS 消费方。
5. 安装后以 lockfile-only diff、依赖树和重新审计确认实际解析版本。

## Compatibility And Rollback

- 不修改数据库 schema 或迁移，Drizzle 升级可通过回退 `package.json` 与 `pnpm-lock.yaml` 整体撤销。
- 不升级 Next 主版本，避免异步 request API、构建配置和运行时最低版本迁移。
- 不升级缓存/队列主版本，因为现有单测不能覆盖真实 Redis 与 PostgreSQL 队列生命周期。
- 若任一候选升级导致类型、测试或 lint 回归，先定位到单个依赖；无法用依赖清单内的小范围调整解决时，回退该候选并记录原因。

## Verification

验证顺序为锁文件冻结安装、依赖树/漏洞审计、测试、lint/typecheck、最终 diff 复核。审计以实际锁文件解析结果为准，而不是仅检查 `package.json` 范围。
