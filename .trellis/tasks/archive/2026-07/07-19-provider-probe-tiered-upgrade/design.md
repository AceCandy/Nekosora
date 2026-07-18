# Design - provider 存活检测分级

> 对应 `prd.md`。技术设计:数据模型、checkHealth 改造、UI、文案、测试、spec。

## 设计原则

两级存活检测,**各层独立展示、诚实命名**,不合并成含糊"健康度":

| 层 | 来源 | 判定 | 展示 |
|---|---|---|---|
| 网络层 | key 探测的 errorKind | 任一非 network 即通 | 不通时红"网络不通" |
| key 层 | GET /models 401/403 vs 2xx | 每 key ok/auth | X/Y 徽章 + hover per-key |

## 1. 数据模型(迁移 0003)

`providers` 表新增 2 列:

- `last_network_ok` boolean -- 网络层是否连通
- `last_key_results` jsonb -- per-key 结果 `[{index, ok, errorKind?, error?}]`,**不存明文 key**(用 index 标识第几个 key)

复用现有 `lastHealthyKeyCount`/`lastTotalKeyCount`/`lastHealthCheckedAt`(key 层汇总 + 时间)。

## 2. checkHealth 改造(admin/panel actions)

`checkProviderHealth`/`checkMyProviderHealth`:

1. 对每个 key(无 key provider 用空 key)调 `probeProviderKey`(不传 model,GET /models)。
2. 收集 per-key: `{index, ok: result.ok, errorKind: result.errorKind, error: result.error}`。
3. **网络层判定**: `networkOk = probeList 中至少一个 errorKind !== "network"`(能连上服务器即通)。全部 network 失败 -> false。
4. key 汇总: `healthy = ok 的 key 数`,`total = probeList.length`。
5. 落库: `lastNetworkOk` + `lastKeyResults` + `lastHealthyKeyCount`/`lastTotalKeyCount`/`lastHealthCheckedAt`。
6. 返回 `{healthy, total, checkedAt, networkOk, keyResults}` 供 UI 会话级展示。

零额外请求:网络层判定复用 key 探测结果,不单独发空 key 探测。

## 3. UI(ProvidersManager)

密钥数量列:

- **网络层标记**: `networkOk=false` 时红色"网络不通";`true` 不显示(减少噪声)。
- **key 徽章 X/Y**(现有,语义改"密钥有效 X/Y")。
- **hover X/Y 出 per-key 详情**: Popover(hoverDelayMs+clickToggle,复用现有模式),每行 `key #index: 有效/无效(原因)`,不显示明文 key。
- **检测按钮文案**: "检测" -> "存活检测";title "检测 URL 网络连通与密钥有效性"。

`HealthAction` 返回类型加 `networkOk` + `keyResults`;`HealthDisplay` 同步;`displayFor` 回显落库值。

## 4. 文案诚实化(i18n)

| key | 现状 | 改为 |
|---|---|---|
| `healthCheckTitle` | 检测该服务商所有密钥的健康度 | 检测 URL 网络连通与密钥有效性 |
| `healthCheckAllTitle` | 检测全部服务商的密钥健康度 | 检测全部服务商网络连通与密钥有效性 |
| `healthCheck` | 检测 | 存活检测 |
| `healthPartial` | 部分异常 | 部分密钥无效 |
| 新增 `networkDown` | - | 网络不通 |
| 新增 `keyValid` | - | 有效 |
| 新增 `keyInvalid` | - | 无效 |
| 新增 `keyNetworkErr` | - | 网络错误 |
| 新增 `keyResultTitle` | - | 密钥 #{index} 检测结果 |

徽章 title/aria 说明 X/Y 是"密钥有效"。

## 5. 测试

- **新建 `src/lib/providers/probe.test.ts`**:
  - fetch 抛 network 错(ECONNREFUSED/timeout) -> `errorKind: "network"`,ok=false
  - 401/403 -> `errorKind: "auth"`
  - 5xx -> `errorKind: "unknown"`
  - 2xx/404/400 -> `ok: true`
  - mock `fetch`(probeKeyConnectivity 不走 ai-sdk)
- **`panel/actions.test.ts`**: `checkMyProviderHealth` 补 `lastNetworkOk` + `lastKeyResults` 落库断言(全 network 失败->false;有 ok->true)。
- `pnpm test` 全过。

## 6. spec 扩展(`.trellis/spec/backend/provider-probe.md`)

新增章节「两级存活检测」:

- 网络层:任一 key 探测非 network 即通(零额外请求);全 network 失败->不通。
- key 层:每 key GET /models,401/403=auth 无效,2xx=有效,5xx=unknown。
- errorKind 语义:network=URL 不通,auth=key 无效,unknown=上游异常,ok=key 有效。
- 落库回显:`lastNetworkOk` + `lastKeyResults` jsonb(用 index,不存明文 key)。
- 手动触发,不自动。

## 7. 风险 / 回滚

- 网络层判定依赖 key 探测结果推断;无 key provider 空 key 探测(已支持),network 失败即网络不通。
- per-key index 在编辑增删 key 后错位:可接受(编辑后重新检测即刷新)。
- DB 迁移加列,向下兼容(旧 null=未检测),回滚 drop 列。
- 文案改动:纯 i18n,无逻辑风险。
