# Implementation Plan

1. 在 `reasoning.test.ts` 添加 malformed fixed `{off:null}` tracer，运行单用例确认修复前错误返回四档。
2. 在 `getSupportedReasoningLevels` 增加 fixed 分支，只采用显式非空非 off 档；运行 tracer 转绿并保留合法 fixed 用例。
3. 在 `sync-pi-models.test.ts` 添加 Kimi 形态回归：当前 fixed 完整 map、pi deepseek `{off:null}` 必须保留当前 map；运行并确认修复前失败。
4. 调整 `resolveThinkingLevelMap`：fixed 在 pi map 分支前返回现有 curated map，同时保留空字符串规范化；非 fixed 分支不变。
5. 扩展 `passesInvariants` 测试与实现，要求 fixed 恰好一个显式非 off 档。
6. 运行 `drizzle-kit generate --custom` 生成 `0011` migration/journal/snapshot，用 `apply_patch` 填入两款 Kimi 的幂等 JSONB 合并 UPDATE。
7. 在 `model-catalog.test.ts` 增加迁移回归，证明两款 Kimi 都恢复完整 fixed map且其他 capability 通过 JSONB 合并保留。
8. 更新 `.trellis/spec/backend/chat-generation-params.md`，以七节契约记录 fixed 档位解析、同步保护、迁移与测试要求；执行 break-loop 根因分析。
9. 使用两路默认只读子代理分别复核同步/运行时状态机与迁移/测试/规范，主代理按 `file:line` 点验并修正阻塞项。
10. 运行聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 和 `task.py validate`；提交、归档、记录 journal，并立即创建第 18 轮。

## Validation Commands

- `pnpm exec vitest run src/lib/reasoning.test.ts src/lib/sync-pi-models.test.ts src/lib/model-catalog.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-17`

## Risk And Rollback Points

- fixed 运行时不能使用通用缺省档位，也不能自动猜 high；权威档位必须来自目录。
- 同步逻辑必须在采用 pi map 之前识别 current fixed；只保留格式、不保留 map 会重现本次问题。
- fixed 闸门必须检查“恰好一个”，不能只检查“大于零”。
- 新迁移只能追加 `0011`，不得整理或修改任何旧 SQL/journal 时间。
- 数据迁移必须顶层合并 capabilities，不能整体覆盖并丢失 vision/tools 等字段。
- `0011_snapshot.json.prevId` 必须指向 `0010_snapshot.json.id`，journal idx/tag/when 严格追加。
- 若发现需要改变 Kimi 上游请求字段、价格或窗口，应返回规划并拆分，不扩大本轮。

## Completion Gate

- 运行时不再把 malformed fixed 解释为多档，合法 fixed 保持唯一档。
- 同步脚本不会再用 pi 的 `{off:null}` 覆盖 curated fixed map，不变量能阻断零档/多档。
- 两款 Kimi 的存量目录通过 `0011` 修复，迁移元数据完整。
- 独立复核无阻塞项，所有自动化门禁通过。
