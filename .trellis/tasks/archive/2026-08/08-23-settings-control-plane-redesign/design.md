# 设置控制面重设计 Design

## 1. 核心结论

本任务不是给现有五个 Tab 换皮，而是把设置页收敛成一个有真实发布语义的配置控制面：

```text
设置字段 / 输出资源编辑
  -> 自动写入唯一活动草稿
  -> 服务端生成并持久化资源级 before / after
  -> 审查完整差异
  -> 单事务校验、冲突检测、整批应用
  -> 生成单调 revision 与不可覆盖的发布记录
  -> 提交后统一刷新运行时

指定历史发布
  -> 计算该发布真正改过的字段
  -> 检查后续发布是否触碰同一字段
  -> 无冲突时生成新的反向草稿
  -> 沿用正常审查与原子应用流程
```

流量治理另增加持久化小时级聚合。它只保存数字，不保存请求内容、密钥、密钥指纹、主体 ID 或单请求事件。

## 2. 边界与取舍

- 保留 `/admin/settings`，不新建第二套管理产品。
- 一个复杂任务统一实施，不拆 Trellis 子任务：数据事务、运行时生效、历史回滚和 UI 审查彼此构成同一验收闭环；实施计划按阶段隔离验证。
- 只支持数据库已经保证的单管理员，不增加审批、多人协作、命名草稿或评论。
- 只保留一个活动草稿。第一次修改自动创建；应用或放弃后才可创建下一批。
- 变更记录使用“每次发布的资源级完整前后值”，不保存全系统快照，也不引入事件溯源框架。
- 输出模式与输出样式仍是独立生产表；控制面只统一它们的编辑、审查、发布和回滚入口。
- 治理聚合是运维观测，不参与准入判定。聚合刷新失败不得把本应成功或返回 429 的请求改成 503。

## 3. UI / UX 设计

### 3.1 设计方向

- Register：Product。
- 色彩：Restrained，继续使用星云纯白、冷调中性层和稀有天空蓝；不新增暗色模式。
- 使用场景：唯一管理员在日间桌面环境中谨慎调整生产网关，同时要能在手机上完成查看、启停和紧急回滚。
- 参考锚点：DEEIX 的设置壳与统一字段行、Stripe Dashboard 的变更透明度、Linear 的高密度但低噪声交互。
- 不使用指标英雄卡、嵌套卡片、彩色侧条、装饰性星空、毛玻璃或编排式入场。

### 3.2 页面骨架

全局 AppShell 保持不变。设置页内部不再增加一条全高重侧栏，而使用粘性控制条：

```text
PageHeader: 系统设置                     当前发布 r42 · 发布记录

[ 设置搜索................ ] [模型与任务][输出体验][流量治理][网关协议]
移动端：搜索 + 原生分类选择器，不使用隐藏滚动条的横向 Tab

当前分类内容

活动草稿存在时：
[ 草稿 r42 · 6 项变更 ]              [放弃] [审查并应用]
```

- 桌面分类导航保持单行、可键盘操作，并在当前分类内容区重复标题和影响说明。
- 移动端使用有可见标签的原生选择器，避免 Tab 换行和不可发现的横向滚动。
- 设置搜索索引来自同一份设置导航元数据；结果定位到分类与字段锚点，不复制第二份能力判断。
- `basic/model/output-modes/render-styles/governance` 旧 query 值继续映射到新分类，避免旧链接失效。
- 发布记录和活动变更集是跨分类控制面，通过页头入口和底部草稿条进入，不作为第五个平级设置分类。

### 3.3 四个分类

#### 模型与任务

- 用一张任务矩阵呈现 Embedding、标题、摘要、Mem0：任务、来源、Provider/模型、实际生效值、状态、测试。
- 行内展开编辑，不把四个小表单继续堆成四张同形卡。
- 测试只使用待选配置执行探测，不写生产设置；结果显示耗时、成功/失败和固定诊断，不展示密钥或上游敏感响应。

#### 输出体验

- 合并输出模式与输出样式，但用清晰的二段选择说明“改变模型行为”和“改变渲染外观”。
- 桌面使用目录 + 检查器/预览的工作区；移动端按目录、编辑、预览顺序纵向展开。
- 输出模式实时展示最终 system 指令预览。
- 输出样式以真实 Markdown 样本提供桌面/移动预览；custom renderer 和自定义 CSS 保留现有高信任提醒。
- 排序保留拖拽，同时提供上移/下移按钮和键盘路径。
- 用户工作树中 `OutputModesManager.tsx`、`RenderStylesManager.tsx` 已有未提交修改；实施前必须先读当前 diff，再在其上做最小兼容改造。

#### 流量治理

- 上部仍按 Key / 用户展示 RPM、Burst、并发和四类月额度，明确当前值、默认来源、草稿值和实际生效值。
- 下部使用时间序列与紧凑明细展示小时吞吐峰值、并发峰值和按原因分类的拒绝数，不使用装饰性大数字模板。
- 待发布策略触发服务端历史回放：显示过去 7/30/90 天有多少小时的峰值会超过候选 RPM/并发阈值，以及现有月度额度窗口与候选额度的确定性比较。
- 文案固定为“历史回放”，明确“过去负载在该阈值下可能受限，不代表未来流量或保证实际拒绝数”。
- 聚合最后更新时间超过两个刷新周期时显示数据延迟，不用旧数据伪装实时状态。

#### 网关协议

- 收纳 Chat 转发 User-Agent 与 API 网关 User-Agent。
- 每行同时显示保存值、默认值和实际生效值；空值明确表示继承 `Nekusora/{version}`。
- 不为填满页面引入无关协议开关。

### 3.4 关键状态

- 无草稿：字段显示当前生效值，首次改动自动创建草稿。
- 有草稿：所有分类显示草稿覆盖值；底部草稿条持续可见。
- 保存草稿中 / 失败：字段级 pending 和错误；失败保留输入，不只弹 Toast。
- 草稿过期：Server Action 返回 revision/version 冲突，要求刷新后继续，不静默合并。
- 审查：按分类、资源和字段展示 before -> after；创建、删除、启停、排序有独立语义。
- 应用中：主按钮锁定并显示进度；重复提交由服务端状态与版本拦截。
- 应用成功：显示新 revision 和生效状态，再清空活动草稿。
- 回滚冲突：列出被后续发布触碰的字段并阻止生成反向草稿；不提供“强制覆盖”捷径。
- 聚合空态：解释“从启用采集后开始积累”，不伪造历史曲线。

## 4. 持久化模型

### 4.1 设置控制状态

新增 `settings_control_state` 单例表：

- `id = 'global'`
- `current_revision bigint not null default 0`
- `updated_at timestamptz`

应用发布时对该行 `SELECT ... FOR UPDATE`。它同时提供全局串行化边界和运行时缓存代际，不使用非事务序列或仅进程内锁。

### 4.2 变更集

新增 `settings_change_sets`：

- `id`
- `status`: `draft | applied | abandoned`
- `kind`: `edit | rollback`
- `rollback_of`: 可空，自引用到被撤销的已发布变更集
- `actor_id`: 管理员用户 ID
- `base_revision`
- `applied_revision`: 仅 applied 有值并唯一
- `version`: 草稿乐观锁，每次修改递增
- `changes jsonb`: 资源级完整前后值数组
- `created_at / updated_at / applied_at / abandoned_at`

数据库使用 partial unique index 保证全局最多一行 `status='draft'`。不增加独立 change-items 表：当前设置规模小，单行 JSONB 能让草稿版本、差异和状态一起原子更新，避免为单一用途新增仓储层。

迁移同时增加 applied history 保护 trigger：只有 `OLD.status != 'applied'` 的行可以更新或删除。apply 的 `draft -> applied` 状态转换被允许；一旦成为 applied，后续任何 `UPDATE/DELETE` 都由 PostgreSQL 拒绝。应用服务也不暴露修改已发布记录的入口，migration/service 测试必须锁定这条不可变契约。

`changes` 在服务边界使用 zod 判别联合校验：

```typescript
type SettingsChange =
  | {
      resource: "system_setting";
      resourceKey: `system:${string}:${string}`;
      before: { namespace: string; key: string; value: string } | null;
      after: { namespace: string; key: string; value: string } | null;
    }
  | {
      resource: "output_mode";
      resourceKey: `output-mode:${string}`;
      before: OutputModeSnapshot | null;
      after: OutputModeSnapshot | null;
    }
  | {
      resource: "render_style";
      resourceKey: `render-style:${string}`;
      before: RenderStyleSnapshot | null;
      after: RenderStyleSnapshot | null;
    };
```

- 快照包含全部可发布字段和稳定 ID，不包含 `createdAt/updatedAt` 等审计噪声。
- system setting 快照记录“持久化行是否存在 + canonical value”；默认/继承/实际值在读模型中计算，不混入冲突快照。治理 JSON 先按 policy schema 解析并稳定序列化。
- 输出资源按固定 DTO 字段做结构化深比较，不比较 JSON 字符串属性顺序；资源缺失统一为 `null`。
- `null -> value` 是创建，`value -> null` 是删除，二者非空是修改。
- 排序就是相关资源 `sortOrder` 字段的变更；一次排序在同一草稿事务中记录全部 `sortOrder` 发生变化的资源，未变项不进入差异。
- 同一草稿中每个 `resourceKey` 只保留一项：第一次触碰固定 `before`，后续编辑只更新 `after`；恢复到原值时移除该 change。
- 草稿为空时仍保留，直到管理员明确应用或放弃，避免隐式结束批次。

### 4.3 治理小时聚合

新增 `gateway_governance_hourly`：

- `bucket_start timestamptz`，固定 UTC 整点
- `scope`: `key | user`
- `request_count bigint`
- `rpm_peak integer`
- `concurrency_peak integer`
- `rate_rejected bigint`
- `concurrency_rejected bigint`
- `quota_chat_tokens_rejected bigint`
- `quota_image_count_rejected bigint`
- `quota_tts_code_points_rejected bigint`
- `quota_stt_seconds_rejected bigint`
- `updated_at timestamptz`
- 唯一键 `(bucket_start, scope)`，索引 `bucket_start`

`gateway_governance_subjects` 只增加当前分钟计数所需的两个运行态字段：

- `metrics_minute_start timestamptz`
- `metrics_minute_requests integer not null default 0`

它们在既有 subject 行锁和 refill 更新中递增，返回本次具体 Key/用户的分钟计数；不新增热路径 SQL，也不形成新的准入事实源。租约查询已有当前具体 Key/用户活动数，成功或拒绝时返回数值观测供并发峰值采集。主体标识只参与当次运行态计算，不进入小时聚合。

## 5. 草稿写入契约

每个变更 Server Action 必须提交：当前页面看到的 `changeSetId | null`、`draftVersion | null` 和资源 mutation。

服务端事务流程：

1. `requireAdmin()`。
2. 锁 `settings_control_state`。
3. 若页面认为无草稿但数据库已有草稿，返回 stale conflict；否则创建或锁定同一草稿。
4. 校验 `changeSetId`、`version`、`baseRevision`。
5. 从数据库和已有草稿投影出当前资源状态，不信任前端提交的 before/diff。
6. 应用 mutation，重新生成 canonical `before/after`，校验边界并递增 `version`。
7. 草稿事务提交后只执行 `revalidatePath('/admin/settings')` 刷新管理页面；它不清生产运行时缓存。

不同浏览器或同一管理员多个标签页不会静默覆盖：任一提交成功后，旧页面的 draft version 立即失效。

## 6. 原子应用

应用操作在单个 PostgreSQL 事务中完成：

1. 鉴权并锁 control state 与活动草稿。
2. 校验草稿 ID/version/status/baseRevision。
3. 解析全部 changes，并重新读取生产资源。
4. 确认每个当前资源仍等于记录的 `before`；任何直接写入或旧路径旁路都会成为冲突。
5. 在完整投影上执行跨项校验：允许的 system key、模型/provider 归属和可路由性、完整治理策略、内置样式限制、CSS class 唯一、ID 唯一和连续排序。
6. 按删除 -> 更新 -> 创建 -> 排序写入 `system_settings`、`output_modes`、`render_styles`。样式 `cssClass` 创建后保持稳定，不增加交换 slug 的特殊流程。
7. `current_revision += 1`，把草稿改为 applied 并写同一 `applied_revision`、`applied_at`。
8. 任一步骤失败，生产配置、revision 和历史状态全部回滚。

旧的设置保存和输出 CRUD Server Action 不再直写生产表；所有入口改为草稿 mutation。底层读服务可以保留，写路径统一进入 settings-control 服务。

## 7. 反向撤销指定发布

反向撤销不是恢复全量快照：

1. 要求当前没有活动草稿，锁 control state。
2. 加载目标发布、目标之后的 applied changes 和当前生产状态。
3. 从目标每项完整 `before/after` 计算真正变化的字段路径。
4. 普通更新以实际变化字段作为路径；create/delete 使用实体级通配路径 `*`。后续发布在同一 resource 上触碰相同字段，或当前字段不再等于目标 after 时，返回结构化冲突；不创建草稿，也不提供强制覆盖。
5. 无冲突时创建 `kind='rollback'` 的新活动草稿：
   - 目标创建 -> 当前资源删除。
   - 目标删除 -> 以原稳定 ID 恢复完整 before。
   - 目标修改 -> 只把目标真正改过的字段写回 before，保留后续未重叠字段。
6. 新草稿走普通审查、冲突检测和原子应用；原发布和回滚发布都永久保留。

create/delete 必然作用于整个实体：目标创建的反向操作是删除该实体，目标删除的反向操作是恢复完整实体。因此任何后续对同一稳定 ID 的创建、删除或字段修改都与 `*` 冲突；“保留后续未重叠字段”只适用于目标本身是字段级 update/reorder 的情况。

## 8. 运行时生效

- `settings_control_state.current_revision` 是所有设置缓存的代际。
- UA、Embedding、Mem0、启用输出模式和启用输出样式在使用缓存前核对 revision；revision 变化时重读或使用带 revision 的缓存键。
- 标题与摘要模型已经按任务读取数据库，不增加第二套缓存。
- 治理策略继续每次从数据库加载。
- 应用事务内不调用 `cacheDel`、`reset*`、`revalidatePath` 或其他进程外副作用。
- 提交成功后调用一个明确的 settings runtime invalidator，清当前进程缓存并删除旧共享缓存键；即使删除失败，revision-aware 读取也不会继续接受旧代际。
- 草稿保存后的页面 `revalidatePath` 与生产运行时 invalidator 是两类边界：前者只刷新管理页 RSC，后者只能在 apply commit 后执行。
- 应用结果区分“数据库发布失败”和“数据库已发布、局部缓存清理告警”，后者不能伪装成事务回滚。

## 9. 聚合采集与保留

### 9.1 采集

- 请求通过 API Key 鉴权进入治理生命周期后，无论随后放行还是被治理拒绝，都为 Key/用户两个 scope 各记录一次请求；鉴权前失败不计入。拒绝原因另行计数，是请求总数的子集。
- rate repository 在既有 subject 更新中返回该具体 Key/用户跨实例一致的当前分钟请求计数。小时表的 `rpm_peak` 取该 scope 内任一主体观测到的最大分钟计数，不把不同主体相加成伪造的单主体 RPM。
- lease repository 返回该具体 Key/用户并发计数。小时表的 `concurrency_peak` 同样取该 scope 内任一主体的最大观测值。
- `recordGovernanceRejection` 同时记录 `rate | concurrency | quota`、scope 和 quota kind；不记录 operation、用户 ID、API Key ID、请求 ID或自由文本错误。
- 进程内 accumulator 只按 `UTC hour + scope` 保存数字；`request_count` 是该 scope 的 fleet-wide 总数，两个 peak 是该 scope 内任一具体主体的最高水位。它不持久化或查询具体 Key/用户。以 5 秒为目标周期交换一批，并使用 `INSERT ... ON CONFLICT DO UPDATE` 累加计数、对峰值取 `greatest`。
- flush 使用双缓冲：开始时同步把 active buffer 交换成空 buffer，随后才 await 数据库；新请求只写新 buffer。刷新单飞；失败时把旧批次以“计数相加、峰值取 max”同步合并回当前 active buffer，成功批次不再合并，避免覆盖或重复。timer `unref`；失败记录固定低基数指标。Gateway 优雅关闭时等待最后一次 flush。
- 数据库健康时，异常进程退出通常只损失当前约 5 秒目标窗口；数据库写入持续失败或阻塞时，可能损失尚未成功持久化的更长缓冲。已经写入小时表的历史不会因页面或进程重启丢失，采集故障也不改变准入结果。

### 9.2 查询与回放

- 页面只查询聚合 DTO，按小时和 scope 返回峰值、总请求及拒绝原因。
- 候选 RPM/并发回放只比较历史峰值和候选阈值；不把峰值超限换算成虚构的未来拒绝次数。
- 月额度比较复用现有 `gateway_quota_windows` 的 used/reserved 数字，只返回聚合后的最大值、超阈值主体数和月份，不暴露主体 ID。
- 页面提供 7/30/90 天固定范围，不增加任意查询 DSL。

### 9.3 保留

- 固定保留 90 天。
- 复用现有每日 gateway retention claim，在同一维护轮次分批删除过期小时行，不新增 queue handler 或第二套调度框架。

## 10. 迁移与兼容

- 修改 `packages/db/src/schema.ts`，追加新的 PostgreSQL 迁移；不得改写现有 `0000-0002`。
- 提交 SQL、`meta/_journal.json` 和新 snapshot，并同步 `PG_BASELINE_TABLES`。
- 新库迁移插入 `settings_control_state('global', 0)`；存量配置视为 revision 0，不制造虚假历史。
- 旧设置 query 值继续映射；旧配置值、内置资源 ID 和现有会话引用不迁移。
- 不保存 API Key 指纹、主体 ID、请求文本、请求 ID、Provider 信息或原始错误到设置历史与治理聚合。

## 11. 风险与已接受限制

- JSONB 变更集依赖服务层 zod 与 canonical builder 保证形状；规模远小于需要规范化 change-items 表的阈值，后续只有出现超大草稿或 SQL 级字段审计需求才拆表。
- 全局 revision 会让不相关设置更新也触发一次缓存重读；设置变更低频，优先换取跨进程一致性。
- 聚合是近实时而非零损失事件账本；数据库健康时缺口通常不超过一个 5 秒目标窗口，数据库持续失败或阻塞时未持久化缓冲可能更长。需要审计级零损失时应另立需求，并接受热路径持久事件或专用遥测管道的成本。
- 本任务不自动解决管理员自定义 CSS/custom renderer 的既有高信任风险，只确保提醒、预览和影响范围清晰。
