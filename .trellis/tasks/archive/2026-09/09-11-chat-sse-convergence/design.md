# 设计

把 `toolAndSearchHandlers` 扩展为私有 `consumeAssistantStream(body, key, assistantIdx, handlers)`。函数拥有原有工具/搜索/trace 投影、正文和思考合批、错误先 flush 后追加、assistant 标识回填、finish 元数据及 parser 返回后的 flush/终态写入。

handlers 复用 SSEHandlers 的 4 个可选字段：onError 只通知动作记录已收到 wire 错误；onAssistantMessage 用于重生成捕获真实版本 ID；onUserMessage/onTitleUpdated 保留发送专属通知。先通知再回填的既有顺序保持。

请求前准备、HTTP 拒绝、catch 的差异化回滚和 finally 运行态清理仍由动作负责。新会话先迁移 key 再消费；续写在原索引追加而不重建消息。

只改 Store 与其现有测试、直接对应状态规范。前一批导入变更已经单独完成验证，本批基于该工作树继续。
