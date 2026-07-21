# 实施计划

1. 新增 `circuit-breaker.test.ts`，先覆盖 half-open 单探测、成功恢复和失败重开，确认当前实现至少有一项失败。
2. 最小修改 `isProviderAllowed()`：closed 放行、open 未到期拒绝、open 到期首调转 half-open 并放行、half-open 拒绝。
3. 为 `stream.ts` 建立可测试的失败上报路径，先证明最后/唯一路由的可转移错误会计数且确定性错误不计数。
4. 同步修正流式与非流式调用顺序，不改变现有错误分类、日志内容和降级策略。
5. 运行格式与质量验证：

```bash
pnpm exec vitest run src/lib/circuit-breaker.test.ts src/lib/stream.test.ts
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

6. 对照 PRD 逐项独立复核 diff、调用链和测试覆盖，记录剩余风险与下一轮候选问题。

## Risk And Rollback Points

- `stream.ts` 同时承载流式和非流式生成，必须保证两个分支的判断顺序一致。
- 若为测试新增接缝会扩大公共 API，则优先使用模块 mock 或测试现有可观察状态，避免暴露单用途函数。
- 不修改 `routing.ts` 的全熔断 fallback；否则会混入可用性策略变更。
