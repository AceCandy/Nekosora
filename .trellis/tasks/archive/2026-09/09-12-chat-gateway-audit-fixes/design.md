# 修复设计

- 在共享生成入口接入 SDK 下载回调，复用 public-http 的 DNS 校验、固定 IP 连接、重定向和有界读取。保留 SDK 支持的直传 URL 以及 data URL，透传取消信号。
- separateSystem 统一拼接文本块；IRToolDef、入站 parser、SDK ToolSet 同步 strict 可选布尔值。以安装版本的 SDK 行为验证上游 wire 字段。
- getMessageSiblings 返回与历史投影一致的消息 status；store 切换版本时显式覆盖旧 status。
- 续写 repository 在现有 conversation 锁及 content CAS 下追加数据库已有 reasoning，不让客户端传入旧思考作为写入依据。
- 不引入依赖或数据库迁移。改动限定相关实现、相邻测试和必要规范；回滚为撤销这些文件的变更。
