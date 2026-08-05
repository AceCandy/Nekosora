# 技术设计：联网搜索工具轮耗尽后的最终总结与逐调用展示

## Agent 最终总结

`streamChatWithTools` 继续执行最多 5 个带工具模型轮次。若循环正常用尽，说明最后一轮仍是 `finishReason=tool-calls` 且工具结果已经追加到工作消息中；此时再调用一次 `streamChat`，请求沿用累计消息但显式使用 `tools: undefined`。

最终总结流直接透传文本、推理和用量，并把它的 `finish` 作为整个 Agent loop 唯一最终 `finish`。若总结流返回 error、自然 EOF、抛错或被取消，沿用现有终态与 telemetry 规则，不补成功事件。普通提前结束路径保持不变。

该设计把 `maxSteps` 保持为“最多工具轮次”，额外总结只在耗尽路径发生。相比单纯提高上限，它能保证模型最终失去继续调用工具的能力，避免再次耗尽。

## 搜索参数反馈

Zod 仍是工具入参边界。校验失败返回稳定结构：

```json
{
  "error": "invalid_search_query",
  "message": "freshness 不能与 dateAfter/dateBefore 同时使用"
}
```

提示由已知校验规则生成，不返回 Zod issues、堆栈或原始错误。其他无效参数使用通用“请检查 query、freshness 或日期范围组合”提示。

## 逐调用搜索元数据

数据流：

```text
search_completed/search_failed(toolCallId)
  -> store 按 toolCallId 更新 ToolCallRecord
  -> ChatMessageItem 渲染该记录自己的 backend/reason

processTrace.webSearch.calls(toolCallId)
  + tool_calls(tool_call_id)
  -> 历史加载时合并
  -> 同一 ToolCallRecord 契约
```

`ToolCallRecord` 增加 WebChat 内部可选字段：

- `searchBackend?: WebSearchTraceBackend`
- `statusDetail?: string`

消息级 `searchBackends` 与 `searchResults` 继续用于聚合引用和兼容已有消费者。组件不再把聚合后端挂到首条搜索调用。

历史成功后端以 `processTrace.webSearch.calls` 为准。失败原因优先读取 trace 的安全 `reason`；工具参数在进入 trace 前校验失败时，只从现有 `tool_calls.error_json` 白名单提取内部搜索工具返回的 `message` / `reason`，不向 UI 暴露原始错误对象。本任务不新增数据库字段。

## 兼容与回滚

- 新字段均可选，旧历史消息与旧 SSE 帧继续工作。
- 不改变数据库结构或公开 API。
- 回滚时删除最终总结分支和 UI 可选字段即可；已有 process trace 数据不受影响。
