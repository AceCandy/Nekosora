# 实施清单

- [x] 定位 coordinator 提前关闭 iterator 与 stream telemetry 收尾之间的跨层缺口。
- [x] `finish`/`error` 后推进一次内层 iterator。
- [x] `streamChat` 在消费者关闭时请求嵌套 engine 收尾。
- [x] 将最终 usage 回调移入 stream `finally`，覆盖自然结束与取消。
- [x] 增加 coordinator、plain stream 与 Abort telemetry 回归测试。
- [x] 运行定向测试、全量测试、lint、typecheck、build 与 diff/task 校验。
- [x] 独立复核后提交实现、规格和任务记录。
