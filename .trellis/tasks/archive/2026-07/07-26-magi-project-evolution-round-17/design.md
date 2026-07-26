# Technical Design

## Boundary

改动限定在：

- `src/lib/reasoning.ts` / `src/lib/reasoning.test.ts`：fixed 档位解析。
- `src/lib/sync-pi-models.ts` / `src/lib/sync-pi-models.test.ts`：fixed 同步保护与不变量。
- `drizzle/pg/0011_*.sql`、`drizzle/pg/meta/_journal.json`、`drizzle/pg/meta/0011_snapshot.json`：存量目录修复。
- `src/lib/model-catalog.test.ts`：迁移数据回归。
- `.trellis/spec/backend/chat-generation-params.md`：fixed 目录与同步契约。

不修改 ChatToolbar、请求协议、Provider 路由、旧迁移或数据库 schema。

## Fixed Reasoning Contract

`fixed` 表示模型会推理，但官方接口不公开关闭或强度控制：

```text
reasoning = true
thinkingFormat = fixed
thinkingLevelMap = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "default",
  xhigh: null,
  max: null
}
```

- 唯一非空的非 off 项是内部状态档位；Chat 用单档列表显示固定状态。
- `applyReasoningToCompatibleBody` 对 fixed 保持原请求体，不伪造控制字段。
- fixed 缺省 map 键不继承普通模型的 off/minimal/low/medium/high 默认值。
- 零个或多个显式开启档都属于非法目录；运行时返回显式档位集合，同步闸门要求集合长度恰好为 1。

## Sync Flow

```text
current catalog row (fixed + curated map)
  + matched pi row (deepseek + {off:null})
  -> resolveThinkingFormat: keep fixed
  -> resolveThinkingLevelMap: fixed branch keeps current curated map
  -> getSupportedReasoningLevels: [high]
  -> passesInvariants: exactly one fixed level
  -> no capabilities diff
```

非 fixed 的 OpenAI-compatible 模型继续采用 pi 的非聚合 `thinkingFormat` 与 map；原生 API 和网关格式的既有分支不变。

## Runtime Defense

`getSupportedReasoningLevels` 在 `thinkingFormat === "fixed"` 时，只返回 map 中显式非空且不是 `off` 的档位。这样 `{off:null}` 返回空数组，不会渲染假滑杆；合法 map 返回 `["high"]`。

不在运行时自动合成 `high`，因为这会掩盖目录损坏。新迁移负责修复权威数据，同步不变量负责阻止再次落盘。

## Migration

使用 Drizzle custom migration 在当前 `0010` 后生成 `0011` journal/snapshot，再填入幂等 UPDATE：

```sql
UPDATE model_catalog
SET capabilities = capabilities || '{
  "thinkingFormat":"fixed",
  "thinkingLevelMap":{
    "off":null,"minimal":null,"low":null,"medium":null,
    "high":"default","xhigh":null,"max":null
  }
}'::jsonb,
updated_at = now()
WHERE canonical_model_id IN (
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed'
);
```

顶层 JSONB 合并只替换两个推理键，保留 vision/tools/reasoning/systemPrompt 及未来其他 capabilities。UPDATE 可重复执行，结果稳定。

## Test Design

1. Runtime tracer：malformed fixed `{off:null}` 预期空档；修复前得到四档。
2. Sync tracer：当前 fixed 完整 map + pi deepseek `{off:null}`，预期 map 原样保留；修复前被覆盖。
3. Invariant：fixed 零档和两档为 false，恰好一档为 true。
4. 现有合法 fixed 用例继续证明默认/夹取为 high 且请求体不变。
5. 目录迁移测试读取 `0011`，断言两 canonical ID、`thinkingFormat:fixed`、完整 null 集合与唯一 high default，并断言使用 JSONB 合并。
6. 运行 reasoning、sync、model-catalog 聚焦测试后执行全量门禁。

## Compatibility And Rollback

- 合法 fixed 模型行为不变；Kimi 从错误多档恢复为固定单档。
- 非 fixed 模型档位与请求翻译不变。
- 无 schema 变更。回滚代码和 `0011` 提交会恢复旧行为；已执行的数据 UPDATE 可通过反向迁移改回，但不建议，因为旧数据违反现行契约。
- 若上游未来公开真实强度控制，应以新证据把 Kimi 改为对应格式和显式档位，不能在 fixed 下塞入多个档。
