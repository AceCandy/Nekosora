# 熔断正确性设计

## Boundaries

- `circuit-breaker.ts` 负责 provider 状态机和运行时状态。
- `stream.ts` 负责判断生成错误是否属于 provider 可转移失败，并在决定是否继续下一路由之前上报。
- 不修改 `routing.ts` 的全熔断降级策略，也不新增公共配置或持久化状态。

## State Contract

```text
closed --threshold failures--> open
open --cooldown + first caller--> half-open (allow)
half-open --other callers--> half-open (deny)
half-open --success--> closed
half-open --failure--> open (new cooldown)
```

`half-open` 本身表示探测名额已被占用，因此不需要新增布尔字段。JavaScript 单线程内对 Map 状态的读取和赋值连续完成，首个调用完成状态转换后，后续调用会看到 `half-open`。

## Failure Reporting

流式与非流式路径采用相同顺序：

1. 计算错误是否可故障转移。
2. 若可转移，立即向 provider 熔断器上报一次失败。
3. 若不可转移或已是最后一条路由，停止当前路由循环。
4. 否则记录路由转移日志并尝试下一条路由。

这样“是否记录健康状态”不再依赖“是否存在下一条路由”，同时确定性请求错误仍不会污染 provider 健康度。

## Compatibility And Rollback

- 公共函数签名、错误响应和路由排序不变。
- 唯一行为变化是 half-open 并发请求被抑制，以及终端可转移失败开始正确计数。
- 回滚只需恢复 `circuit-breaker.ts`、`stream.ts` 和新增测试，不涉及数据迁移。
