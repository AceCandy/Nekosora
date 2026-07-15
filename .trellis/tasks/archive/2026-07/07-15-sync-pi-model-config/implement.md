# Implement — 同步 pi 模型配置

## 执行清单

### A. 脚本骨架
- [ ] A1 新建 `scripts/sync-pi-models.ts`,先验证 `import { MODELS } from "../docs/cankao/pi/packages/ai/src/models.generated.ts"` 可用(整包 import);失败则切 §2 fallback 白名单 import。
  - verify:`pnpm tsx scripts/sync-pi-models.ts --check-import` 打印 provider 数(≈35)与总模型数。
- [ ] A2 实现 `loadCatalogChatModels()`:解析 `drizzle/pg/0000_baseline.sql` 中 model_catalog 的 chat 条目(含历次 UPDATE 叠加后的最终能力)。MVP 用静态解析,不连 DB。
  - verify:打印现有 chat 条目数,含 `glm-5.2/kimi-k2.5/claude-fable-5/gemini-3-flash`。

### B. 匹配 + 翻译
- [ ] B1 实现 `match()`(design §3):精确 `provider/id` 优先,裸 `id` 次之,多/零命中入未匹配。
- [ ] B2 实现 `translate()`(design §4/§5):产出目标 capabilities + context_window + max_output_tokens;`thinkingFormat` 按 §5 保留/采用;移除 pi 无对应的 `thinkingLevelMap` 键。
- [ ] B3 实现 `assertInvariants()` + `diff()`:前者复用 `getSupportedReasoningLevels` 断言三条不变量,违反字段回退现状;后者逐字段 `旧值→新值`,跳过无变化字段。
  - verify:`--dry-run` 输出差异报告,核对:
  - `glm-5.2`: `thinkingLevelMap.low null→"high"`, `.medium null→"high"`, `context_window 空→1000000`, `max_output_tokens 空→131072`。
  - `kimi-k2.5`/`kimi-k2.6`: `thinkingLevelMap.high ""→"high"`(**不移除** map;贴 pi「无 map」被闸门拦截并记报告)。
  - `claude-fable-5`: `thinkingFormat` 保持 `anthropic-adaptive`;普通 claude(如 `claude-haiku-4-5`)/gemini: `anthropic`/`google` 标识被去掉。
  - 列出未匹配 / 非 chat / 被闸门拦截字段 清单。

### C. 生成迁移
- [ ] C1 生成 `drizzle/pg/0001_sync_pi_models.sql`:每条 `INSERT ... ON CONFLICT(canonical_model_id) DO UPDATE SET capabilities=EXCLUDED.capabilities, context_window=..., max_output_tokens=...`(capabilities 全量覆盖)。
- [ ] C2 更新 `drizzle/pg/meta/_journal.json`:追加 idx=1 entry(tag `0001_sync_pi_models`)。
- [ ] C3 复制 `0000_snapshot.json` → `0001_snapshot.json`(schema 未变)。
  - verify:`ls drizzle/pg` 出现 `0001_sync_pi_models.sql`;`_journal.json` 含两条 entry。

### D. 测试
- [ ] D1 `match()`/`translate()`/`assertInvariants()` 单测(vitest):覆盖 glm-5.2 / kimi-k2.5 / claude 原生 / 未匹配 / 闸门拦截 五类。
- [ ] D2 `0001_sync_pi_models.sql` 快照测试。
- [ ] D3 幂等:模拟两遍重放,catalog 状态一致。
  - verify:`pnpm vitest run <相关测试>` 全绿。

### E. 收尾
- [ ] E1 自检:未触碰 schema、前端、路由层;`docs/cankao/pi` 只读。
- [ ] E2 触发 `trellis-check` 复核 → `trellis-update-spec`(若沉淀约定)→ commit + push + 归档。

## 验证命令汇总

```bash
pnpm tsx scripts/sync-pi-models.ts --dry-run          # 差异报告
pnpm tsx scripts/sync-pi-models.ts                    # 生成 0001 迁移
pnpm vitest run src/.../sync-pi-models.spec.ts        # 单测
pnpm db:migrate:pg                                    # 应用迁移(需用户批准)
```

## Review Gate

- B3 dry-run 差异报告出来后,与用户确认「要刷的模型 + 字段」无误,再进 C 生成迁移。

## 回滚点

- 任何阶段失败:脚本产物(0001 sql + journal)未应用即可丢弃;已应用则在事务内按报告旧值反向 UPDATE。
