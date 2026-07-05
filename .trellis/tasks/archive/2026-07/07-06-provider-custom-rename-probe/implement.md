# Implement:custom → openai-compatible 改名 + 三方探测修复

## 执行清单

### A. 代码改名
1. `db/types.ts`:ProviderProtocol `"custom"` → `"openai-compatible"`
2. `db/schema/pg.ts`:providerProtocol pgEnum `"custom"` → `"openai-compatible"`
3. `registry.ts`:`case "custom"` → `case "openai-compatible"`
4. `probe.ts`:PROBE_MODEL key `custom` → `openai-compatible`;switch case 同步
5. `admin/providers/page.tsx`:UI 下拉 value/label
- verify:`grep -rn '"custom"' src/lib/providers/ src/db/types.ts src/db/schema/pg.ts` 无 provider 协议残留

### B. pg 迁移
1. `pnpm db:generate:pg`
2. 检查生成的 `drizzle/pg/0002_*.sql`:应为 RENAME VALUE;若 drizzle 生成 ADD 或错误,手写修正为 `ALTER TYPE provider_protocol RENAME VALUE 'custom' TO 'openai-compatible';`
3. 同步 `drizzle/pg/meta/0002_snapshot.json` 中 provider_protocol enum 值
- verify:迁移 SQL 含 RENAME VALUE,snapshot enum 值正确

### C. sqlite 迁移
1. 手写 `drizzle/sqlite/0002_rename_custom_protocol.sql`(两条 UPDATE)
2. 在 `drizzle/sqlite/meta/_journal.json` 加 entry(idx:2)
- verify:journal 含 idx:2

### D. 探测修复(probe.ts)
1. probeProviderKey 未传 upstreamModelName 分支:先 fetchUpstreamModels,成功用首个模型,失败降级 PROBE_MODEL
- verify:代码审查

### E. 全量验证
1. `pnpm typecheck` → 0 错
2. `pnpm test` → 全过
3. `pnpm lint` → 无新增 error
4. `grep -rn '"custom"' src/`(provider 协议相关无残留)

## 风险点

- drizzle pg enum 迁移生成不可靠,必须人工核实 0002 SQL
- sqlite 手写迁移 journal 格式
- pg RENAME VALUE 不可逆,开发库先验证
