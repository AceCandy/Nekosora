# Design:custom → openai-compatible 改名 + 三方探测修复

## 改名影响面

provider 协议 `custom` 的引用(代码 + DB):

| 位置 | 改动 |
|------|------|
| `src/db/types.ts` ProviderProtocol | `"custom"` → `"openai-compatible"` |
| `src/db/schema/pg.ts` providerProtocol pgEnum | `"custom"` → `"openai-compatible"` |
| `src/lib/providers/registry.ts` | `case "custom":` → `case "openai-compatible":` |
| `src/lib/providers/probe.ts` PROBE_MODEL key + switch case | `custom` → `openai-compatible` |
| `src/app/(dash)/admin/providers/page.tsx` UI 下拉 | value/label → `openai-compatible` / 「OpenAI 兼容」 |

DB 数据(两张表用 providerProtocol enum):
- `global_providers.protocol`
- `global_routes.protocol`

sqlite schema 列定义不变(text 列),仅 TS 类型 ProviderProtocol 变,故 sqlite 不会由 generate 产出迁移。

## DB 迁移方案

### pg

Postgres enum 值重命名:`ALTER TYPE provider_protocol RENAME VALUE 'custom' TO 'openai-compatible';`
- RENAME VALUE(Postgres 10+)会**自动传播**到所有引用该 enum 类型的列,global_providers 与 global_routes 的 custom 数据自动变 openai-compatible,无需单独 UPDATE。
- **drizzle-kit 0.30 不支持 enum 值 rename 的自动迁移**:它会把「custom 消失 + openai-compatible 出现」识别为 ADD VALUE,生成错误 SQL。
- 顺序:改 pg.ts → `pnpm db:generate:pg` → 人工检查 0002 SQL → 修正为 RENAME VALUE → 同步 meta snapshot 的 enum 值。

### sqlite

text 列无 enum 约束,schema 列定义不变,drizzle generate 不会产出迁移。手写迁移文件:
- `drizzle/sqlite/0002_rename_custom_protocol.sql`:
  ```sql
  UPDATE global_providers SET protocol='openai-compatible' WHERE protocol='custom';
  UPDATE global_routes SET protocol='openai-compatible' WHERE protocol='custom';
  ```
- 手动在 `drizzle/sqlite/meta/_journal.json` 注册 entry(idx:2, tag:`0002_rename_custom_protocol`)。
- bootstrap 的 migrate 按 journal 消费 sql 文件,不依赖 snapshot。

## 探测修复设计

`probeProviderKey`(probe.ts)现状:未传 upstreamModelName 时用 `PROBE_MODEL[protocol]`(custom/openai 均为 gpt-4o-mini)。

修复(仅未传 upstreamModelName 分支):
1. 调 `fetchUpstreamModels({ protocol, baseUrl, apiKey, headers })` 拉真实模型
2. 拉成功 → 用第一个模型作为探测 model(覆盖占位)
3. 拉失败 → 降级占位模型 PROBE_MODEL,保持原行为
4. 用最终 model 跑 generateText 探测

传了 upstreamModelName 的分支(testRoute)不变。

`fetchUpstreamModels` 本身已验证 key+baseUrl+鉴权(GET /models 成功),再用其首个模型 generateText 验证完整生成链路。这样官方、第三方上游都能正确探测。

## 风险与回滚

- pg RENAME VALUE 不可逆(回滚需反向 RENAME),迁移提交前在开发库验证。
- drizzle generate 产物必须人工核实,不能盲用。
- sqlite 手写迁移 journal 格式要对(idx/tag/when),否则 migrate 报错。
- 探测修复新增一次 /models 请求,探测是低频配置操作,可接受。
