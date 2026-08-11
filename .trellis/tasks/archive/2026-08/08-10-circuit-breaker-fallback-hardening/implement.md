# 熔断降级策略加固实施计划

## Success Criteria

1. 全部不健康时没有上游调用，并稳定返回 `routing.no_healthy_route` / 503。
2. 同 Provider half-open 同时只有一个许可，所有 Engine 终态都能释放。
3. 正常路由顺序、Key/route fallback、timeout、Abort 和提交边界不回归。
4. 错误、低基数指标和 execution facts 可独立识别该场景。

## Ordered Checklist

### 1. Freeze failing behavior with tests

- 扩展 `circuit-breaker.test.ts`：availability、token ownership、neutral/success/failure release、多 Provider 隔离。
- 扩展 `routing.test.ts`：部分熔断保留健康路由；全部 open / probe busy 返回稳定错误，不再返回全集。
- 扩展 `gateway-execution/engine.test.ts`：许可竞争、无健康路由、所有提前终态的 release。

Verify:

```bash
pnpm --filter @nekusora/core exec vitest run \
  src/lib/circuit-breaker.test.ts \
  src/lib/routing.test.ts \
  src/lib/gateway-execution/engine.test.ts
```

### 2. Implement permit ownership

- 在 `circuit-breaker.ts` 增加纯 availability、一次性 probe token 和 permit；删除无调用的 fail-open helper。
- 将 `GatewayBreakerPort` 改为 acquire/release 契约。
- 在 Engine route 边界获取许可，并以 `finally` 覆盖 adapter rejection、空 Key、Provider-start、Abort 和异常返回。
- 更新 Chat、Hosted Search、Image、TTS、STT 调用方，统一注入同一 breaker port。

Verify:

```bash
pnpm --filter @nekusora/core typecheck
pnpm --filter @nekusora/core exec vitest run src/lib/gateway-execution/engine.test.ts
```

Rollback point: permit/Engine/caller 接线作为一个原子修改单元；任何调用方未切换时不得进入下一步。

### 3. Remove fail-open routing

- 路由过滤改用无副作用 availability。
- 无候选时抛 `routing.no_healthy_route`，Engine 并发竞争窗口使用相同结果。
- 保持 capability 检查只处理非空 route chain。

Verify:

```bash
pnpm --filter @nekusora/core exec vitest run \
  src/lib/routing.test.ts \
  src/lib/stream-circuit-breaker.test.ts
```

### 4. Complete error and observability contracts

- 新增错误码、meta、i18n、routing mapper 和 error classifier。
- 新增一个固定 `event` label 的 breaker counter 和便捷函数。
- 断言无高基数标签，metrics smoke 注册新 counter。
- 确认 no-healthy execution 只有 final fact，没有伪造 attempt。

Verify:

```bash
pnpm --filter @nekusora/core exec vitest run \
  src/lib/errors.test.ts \
  src/lib/error-classify.test.ts \
  src/lib/protocols/encoders.test.ts \
  src/lib/infra/metrics.test.ts \
  src/lib/gateway-execution/telemetry.test.ts
pnpm --filter @nekusora/observability typecheck
```

### 5. Cross-protocol and media regression

- Chat stream/generate 覆盖全熔断、单探针并发、成功恢复、失败重开和健康备用 Provider。
- Image/TTS/STT 覆盖稳定 503，不被媒体 502 覆盖。
- 保留现有 timeout/caller cancellation、工具拒绝、stream-options fallback 和 committed response 测试。

Verify:

```bash
pnpm --filter @nekusora/core exec vitest run \
  src/lib/stream-circuit-breaker.test.ts \
  src/lib/protocols/multi-protocol-matrix.test.ts \
  src/lib/providers/multimodal/image-gen.test.ts \
  src/lib/providers/multimodal/audio-adapters.test.ts
```

### 6. Independent review and full gates

- 独立复核状态迁移、permit 终态完整性、协议映射、低基数指标和所有 Engine caller。
- 根据实际 affected package 重新读取 Quality Check，并运行全量门禁。

Verify:

```bash
pnpm check
pnpm test
pnpm build
pnpm build:gateway
git diff --check
```

## Risk Checklist

- [ ] 同一 Provider 的多 route 不会各自获得并发 probe。
- [ ] Key fallback 期间 probe 仍由同一许可持有，最终成功可覆盖前序 Key 失败。
- [ ] 迟到 permit 不会结算新的 probe token。
- [ ] Abort / deterministic / rejected / empty-key / provider-start 都进入 `release()`。
- [ ] 部分 Provider 熔断时不会错误返回全局 503。
- [ ] all-rejected request error 的优先级不会被 no-healthy 覆盖。
- [ ] no-healthy 不产生 upstream attempt，不泄漏原始错误或凭据。
- [ ] metric label 集合固定且不包含业务 ID。

## No Service Requirement

本任务不需要启动 Web 或 Gateway 服务。若验证中临时启动任何进程，结束前必须关闭并删除调试产物。
