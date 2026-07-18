# Implement - provider 存活检测分级

> 对应 `design.md`。有序执行清单 + 验证 + review gate。

## 执行清单

### 1. DB 迁移
- [ ] `src/db/schema/pg.ts`:`providers` 加 `lastNetworkOk` boolean + `lastKeyResults` jsonb(注释业务含义,标注不存明文 key)。
- [ ] `pnpm db:generate:pg` 生成 0003 迁移,人工核实 SQL(ADD COLUMN ×2)。
- [ ] 确认 `drizzle/pg/meta/_journal.json` + snapshot 同步。

### 2. probe 单测(先红)
- [ ] 新建 `src/lib/providers/probe.test.ts`,mock `fetch`。
- [ ] network 错(ECONNREFUSED/timeout/fetch failed) -> `errorKind:"network"`,ok=false。
- [ ] 401/403 -> `errorKind:"auth"`;5xx -> `errorKind:"unknown"`;2xx/404/400 -> ok=true。
- [ ] `pnpm test probe` 红->后续转绿。

### 3. checkHealth 分级改造
- [ ] `admin/actions.ts` `checkProviderHealth`:每 key 调 `probeProviderKey`(不传 model),收集 per-key `{index, ok, errorKind, error}`;`networkOk = 至少一个非 network`;落库 `lastNetworkOk`+`lastKeyResults`+汇总;返回加 `networkOk`+`keyResults`。
- [ ] `panel/actions.ts` `checkMyProviderHealth`:同上。
- [ ] 无 key provider:空 key 探测,network 失败即 networkOk=false。

### 4. ProvidersManager UI
- [ ] `HealthAction`/`HealthDisplay` 类型加 `networkOk` + `keyResults`。
- [ ] `displayFor` 回显落库 `lastNetworkOk`/`lastKeyResults`。
- [ ] 密钥数量列:`networkOk=false` 显红"网络不通";X/Y 徽章 hover 出 per-key 详情(Popover,每行 `key #index: 有效/无效(原因)`)。
- [ ] 检测按钮文案改"存活检测",title 诚实。

### 5. i18n 文案诚实化
- [ ] `messages/zh-CN.json` + `en.json`:改 `healthCheckTitle`/`healthCheckAllTitle`/`healthCheck`/`healthPartial`;新增 `networkDown`/`keyValid`/`keyInvalid`/`keyNetworkErr`/`keyResultTitle`。

### 6. 补 actions 测试
- [ ] `panel/actions.test.ts`:`checkMyProviderHealth` 补 `lastNetworkOk` + `lastKeyResults` 落库断言(全 network->false;有 ok->true)。

### 7. spec 扩展
- [ ] `.trellis/spec/backend/provider-probe.md`:加「两级存活检测」章节(网络层判定 + key 层 + errorKind 语义 + 落库回显 + 不存明文 key)。

## 验证

- [ ] `pnpm typecheck` 0 错
- [ ] `pnpm lint` 无新增告警
- [ ] `pnpm test` 全过(含新 probe.test.ts + actions 分级断言)
- [ ] dev 抽查:检测按钮跑两级;网络不通显红;hover per-key 详情;刷新回显最后一次;无 key provider 空 key 探测

## Review Gate

- 网络层判定用「任一非 network 即通」(零额外请求),不独立空 key 探测。
- per-key 落库用 index 标识,不存明文 key;编辑后错位可接受(重新检测刷新)。
- 回滚点:DB 迁移独立可 drop;checkHealth 分级段可短路与跳过;UI 网络标记/per-key hover 可隐藏不破坏功能。
