# 技术设计

## 边界

`executeChatCompletion` 负责把已消费的 Chat 终态交给内层流完成；`streamChat` 负责关闭嵌套 `executeGateway` 并在自身清理路径触发最终 usage 回调；`streamChatWithTools` 继续由自己的 `finally` 统一聚合 Agent telemetry。

## 生命周期

1. `finish`/`error` 已锁存后，协调器推进一次 iterator，让普通流或 Agent loop 执行到 `finally`，随后才持久化 Chat completion。
2. Abort 保持非阻塞 `return()` 请求，避免不响应 AbortSignal 的 provider 阻塞 Chat 收敛。
3. 流被消费者 `return()` 时，`streamChat` 在 `finally` 请求内部 engine 关闭；engine 根据 Abort 或未正常收敛状态完成 execution telemetry。
4. `suppressFinalUsageLog` 的回调与流清理绑定，不能依赖 `finally` 之后仍会执行的代码；若消费者提前关闭且没有 engine outcome，按 Abort/未收敛状态生成最小终态。

## 取舍

不修改用量查询的成功过滤，不回填历史 `running` 行，也不把 coordinator 的 Abort 改为等待 provider。这样修复新请求生命周期，同时保留现有计费语义和取消响应性。
