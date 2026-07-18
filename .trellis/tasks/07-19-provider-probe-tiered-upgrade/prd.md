# provider 存活检测分级:网络层 + key 层,文案诚实化

## Goal

把 provider 检测从「含糊健康度 X/Y」升级为诚实的两级存活检测:

- **网络层**:供应商 URL 是否可达(网络连通,不涉及 key)。
- **key 层**:每个 key 鉴权是否有效(GET /models 看 401/403)。

手动点击测一次,不频繁;平时展示最后一次检测记录(落库回显)。最小耗费(GET /models,不发生成请求)。

## Background

现状(2026-07-19 调研):

- `probeProviderKey` 不传 model 走 `probeKeyConnectivity`(GET /models),`ProbeResult.errorKind` 已分 `network`/`auth`/`unknown`/ok--**探测逻辑已满足两级判定**,不发生成(最小耗费)。
- `checkProviderHealth`/`checkMyProviderHealth` 把每 key 结果汇总成 healthy/total X/Y,**丢弃 network/auth 分级与 per-key 细节**。
- 落库仅 `lastHealthyKeyCount`/`lastTotalKeyCount`/`lastHealthCheckedAt`,无网络状态、无 per-key 详情。
- 文案 `healthCheckTitle="检测该服务商所有密钥的健康度"` 把浅测说成「健康度」,不诚实。
- `probeProviderKey` 是探测唯一中枢(8 处调用),无单测覆盖。
- 探测契约见 `.trellis/spec/backend/provider-probe.md`。

## Requirements

### R1: 文案诚实化

- 检测按钮/徽章文案如实说明测的是「网络连通」和「密钥有效」,不叫「健康度」。
- 失败原因按 network/auth 分类提示(网络不通 vs 密钥无效)。

### R2: 两级分级检测

- **网络层**:URL 是否可达。判定:所有 key 探测均 network 失败 -> 网络不通;任一非 network(能连上服务器) -> 网络通。零额外请求(复用 key 探测结果)。
- **key 层**:每 key 鉴权有效(GET /models,401/403=无效,2xx=有效)。
- 手动触发(单行/全部检测),不自动、不频繁。

### R3: 落库回显

- DB 迁移:providers 加 `lastNetworkOk` boolean + `lastKeyResults` jsonb(per-key: `[{index, ok, errorKind?, error?}]`,不存明文 key)。
- 列表展示最后一次检测结果(刷新后仍可见):网络层标记 + key X/Y + hover per-key 详情。

### R4: spec + 测试

- 扩展 `provider-probe.md`:两级存活检测契约 + errorKind 分类语义。
- 新建 `probe.test.ts`:`probeKeyConnectivity` 的 network/auth/ok 分级单测(当前 0 覆盖)。

## Acceptance Criteria

- [ ] 文案如实说「网络连通」/「密钥有效」,无「健康度」含糊措辞。
- [ ] 检测分网络层(通/不通)+ key 层(每 key 有效/无效+原因)。
- [ ] 手动触发,不自动;落库后刷新仍可见最后一次分级结果。
- [ ] per-key 详情 hover 展示,不存明文 key(用 index)。
- [ ] `probe.test.ts` 覆盖 network/auth/ok 分级,`pnpm test` 全过。
- [ ] `provider-probe.md` spec 含两级检测契约。
- [ ] `pnpm typecheck` 0 错;`pnpm lint` 无新增告警。

## Open Questions

- 网络层判定用「任一非 network 即通」(零额外请求)还是「独立空 key 探测一次」(更直观但多一请求)?倾向前者。
- per-key 落库用 index 标识(简单但编辑后错位),可接受(编辑后重新检测)。
