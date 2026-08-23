# 设置控制面重设计 Implement Plan

## 1. 实施前

- 读取本任务 `prd.md`、`design.md`。
- 加载 `trellis-before-dev`，再次确认 backend/frontend 规范索引。
- 检查工作树；`OutputModesManager.tsx`、`RenderStylesManager.tsx` 的现有未提交修改属于用户，修改前完整阅读当前文件与 diff，不回退或覆盖。
- 先运行设置、治理和迁移相关定向测试，记录基线；不启动产品服务。

## 2. 实施步骤

### Step A：Schema 与迁移

1. 在 `packages/db/src/schema.ts` 新增：
   - `settings_control_state`
   - `settings_change_sets`
   - `gateway_governance_hourly`
   - `gateway_governance_subjects.metrics_minute_start/metrics_minute_requests`
2. 用 `pnpm db:generate:pg` 生成下一条迁移，检查 SQL 后同步 journal/snapshot；不手改已发布迁移。
3. 更新 `PG_BASELINE_TABLES`、迁移 fixture 和专门 migration tests。
4. 在迁移中增加 applied change set 的 immutable trigger，阻止已发布行被更新或删除。

验证：新库有 control 单例；唯一活动草稿、revision、hour/scope 唯一键、UTC 时间戳、索引和 Drizzle journal/snapshot 链均有断言；`draft -> applied` 成功，applied 后 `UPDATE/DELETE` 由 PostgreSQL 拒绝。

回滚点：只回退本次新迁移/schema；不修改现有配置表数据。

### Step B：设置变更集领域服务

1. 新增 settings-control 领域类型、zod 边界和 canonical snapshot/diff helper。
2. 实现：读取当前控制面、首次编辑建草稿、upsert mutation、排序 mutation、放弃草稿。
3. 实现 expected changeSet ID/version/base revision 乐观冲突。
4. 把 system settings、输出模式和输出样式的全部 mutation 投影到同一 `changes` JSONB。
5. 补纯逻辑测试：create/update/delete/no-op、字段 diff、排序、builtin 限制、stale version。

验证：页面重载后草稿存在；第二个草稿无法创建；旧页面 mutation 不覆盖新版本；缺失资源、治理 JSON canonicalization、输出 DTO 结构比较和排序全集均有回归测试。

### Step C：原子发布与反向撤销

1. 实现完整 projected-state 校验和单事务 apply。
2. 将现有设置/输出写入口改为草稿 mutation，底层事务写入只由 settings-control 服务拥有。
3. 实现发布历史查询与字段级 diff DTO。
4. 实现指定发布反向草稿：后续字段重叠和当前值不符均返回结构化冲突。
5. 补 service unit tests 与 PostgreSQL integration tests：跨三类资源成功、任一失败全回滚、重复提交、并发 apply、回滚创建/删除/修改/排序、后续同字段冲突。

验证：同一发布可同时变更 `system_settings`、`output_modes`、`render_styles`；事务失败时 production/revision/history 均不部分更新。

### Step D：运行时 revision 生效

1. 提供读取 `current_revision` 的最小 helper。
2. 让 UA、Embedding、Mem0、启用输出模式/样式缓存感知 revision；缓存键带 revision 或在 revision 变化时重载。
3. 实现提交后统一 invalidator；只在 apply transaction resolve 后调用。
4. 测试旧 revision cache 不再被读取、事务回滚不触发 invalidator、提交后本进程 reset 与跨进程下一次读取收敛。

验证：发布成功后的下一次运行时读取使用新 revision；cacheDel/reset 失败不改写已提交历史，也不回退 production。

### Step E：持久化治理聚合

1. 在既有 subject refill 中维护并返回具体主体的当前分钟计数；在 lease 成功/拒绝路径返回具体主体的并发观测，不新增准入 SQL 往返。
2. 新增只接收数值的进程内 accumulator：小时/scope 的全体请求数、任一主体 RPM/并发最高水位、拒绝原因/额度种类。
3. 每 5 秒以同步 swap + 异步写库的双缓冲单飞 flush 到 `gateway_governance_hourly`；失败按计数相加/峰值 max 合并回新 active buffer，Gateway 关闭时 drain。
4. 扩展现有 retention 日任务清理 90 天前小时行。
5. 新增聚合查询和历史回放服务，额度部分复用 `gateway_quota_windows`。
6. 补并发、口径与隐私测试：所有已鉴权请求按 scope 计数一次、鉴权前失败排除、各类治理拒绝同时计入总数与原因、不同主体峰值取 max 而不求和、多次 flush 累加、失败重试不丢已换出批次、无主体/密钥/请求字段、聚合失败不改变请求结果、保留边界。

验证：服务/页面重启后已持久化历史仍可查；页面能识别刷新延迟，且不承诺故障期间未落库缓冲零损失；聚合行只含数字和固定枚举；回放不输出未来保证。

### Step F：设置页骨架与搜索

1. 将 `SettingsTabs` 收敛为四分类粘性控制条；桌面单行导航，移动端原生选择器。
2. 保留旧 query alias；默认进入“模型与任务”。
3. 建立单份设置导航/search metadata，结果跳转字段锚点。
4. 接入页头 revision、发布记录入口和活动草稿底部条。
5. 补导航、搜索、320/390/768/1280 布局和键盘焦点测试。

验证：无横向裁切；移动端所有分类可发现；旧 `/admin/settings?tab=...` 仍定位到对应能力。

### Step G：四分类内容

1. 模型与任务：任务矩阵、来源/实际值、非持久化测试动作。
2. 输出体验：模式/样式合并工作区、Prompt/Markdown 预览、桌面/移动切换、拖拽与上移/下移等价路径。
3. 流量治理：当前/草稿策略、小时趋势、拒绝原因、数据新鲜度、7/30/90 天历史回放。
4. 网关协议：两个 UA 字段的保存/default/effective 语义。
5. 所有编辑 action 只写活动草稿，不直写 production。

验证：现有五个 Tab 的每项能力都能从四分类或搜索定位；核心操作仅键盘可完成。

### Step H：审查、发布历史与回滚 UI

1. 实现活动草稿审查视图，按分类/资源/字段呈现差异。
2. 实现 apply/abandon pending、成功、失败、stale conflict 状态。
3. 实现发布历史列表、展开差异、反向撤销入口和冲突清单。
4. 更新中英文 i18n；不只依赖 Toast，关键状态使用行内 `aria-live/role=alert`。

验证：换设备后草稿仍可审查；回滚无冲突时生成新草稿，有冲突时不创建、不覆盖。

## 3. 定向验证

迁移与核心领域：

```bash
pnpm --filter @nekusora/core exec vitest run \
  src/lib/settings-control \
  src/lib/gateway-governance \
  src/lib/gateway-execution/retention-migration.test.ts \
  src/lib/infra/db/bootstrap.test.ts
```

Web 设置页：

```bash
pnpm --filter @nekusora/web exec vitest run "src/app/(dash)/admin/settings" \
  src/features/output-modes \
  src/features/render-styles
pnpm --filter @nekusora/web lint
pnpm --filter @nekusora/web typecheck
```

受影响包：

```bash
pnpm --filter @nekusora/core lint
pnpm --filter @nekusora/core typecheck
pnpm --filter @nekusora/gateway lint
pnpm --filter @nekusora/gateway typecheck
pnpm --filter @nekusora/worker lint
pnpm --filter @nekusora/worker typecheck
pnpm --filter @nekusora/db typecheck
git diff --check
```

需要 PostgreSQL 的隔离测试在 `DATABASE_URL` 可用时运行；没有数据库时必须报告未验证，不把 `describe.skip` 当成通过。

## 4. 浏览器验收

项目没有现成 Playwright/Cypress。实现完成后若本地环境可启动：

1. 启动 Web、Gateway、Worker，访问四分类、搜索、草稿审查、发布历史与治理回放。
2. 以 320/390/768/1280px 检查无横向溢出，触屏目标不小于 44px。
3. 仅用键盘完成分类切换、字段编辑、排序、审查和应用。
4. 制造一个校验失败和 stale version，确认输入保留且错误可见。
5. 创建测试发布并反向撤销，确认只影响该发布字段。
6. 检查聚合新鲜度、空态和“历史回放非未来保证”文案。
7. 验收后关闭所有调试服务。

## 5. 独立复核门

- 运行 `trellis-check` 做一次与实现分离的复核：PRD 覆盖、原子边界、冲突算法、缓存代际、聚合隐私、i18n、可访问性、测试和工作树保护。
- 检查生产写入口，确认没有遗留绕过 change set 的 settings/output mutation。
- 检查事务代码，确认所有 cache/reset/revalidate 均位于 commit 之后。
- 检查聚合持久化 DTO 和 SQL，确认不存在 userId/apiKeyId/指纹/requestId/自由文本。

## 6. 回滚策略

- UI 可单独回退到旧分类渲染，但一旦 change set 上线，旧直写 action 不得恢复；否则会绕过 revision/history。
- 新表和历史数据保留，代码回滚不得删除已应用记录。
- 若聚合采集异常，可停止 recorder/页面趋势读取，治理准入继续使用现有 PostgreSQL 状态；不要回退准入策略语义。
- 若运行时 revision 检查异常，可临时绕过缓存直接读数据库，不恢复永久进程缓存。
