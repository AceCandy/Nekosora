# 出图方式与 Responses 适配

- `ModelCapabilities.imageGenerationFormat` 可选值 `openai-images` / `openai-responses`，缺省 Images。复用 JSONB capabilities，无列变更、无种子数据变更，因此不产生数据库迁移。
- 目录编辑保持即时保存，用三态选择替代只表达启停的开关；关闭保留已选格式。原子 JSONB patch 保留其他能力。
- 图像入口仍以 imageGeneration 为门槛；目录配置派生图片尺寸与数量，Web 不按模型名判断能力。
- Core 复用已安装 @ai-sdk/openai 4.0.16 和 ai 7.0.31：generateText + provider.responses + tools.imageGeneration + 指定 toolChoice。工具图片模型省略，使用上游默认；强制 PNG，与现有存储契约一致。
- Responses 仅接受 openai/openai-compatible Provider，且路由与目录均允许工具；不以聊天 route.apiFormat 替代出图语义。Images 保留现有协议范围。
- 单请求单图，无自动多次调用；SDK maxRetries=0，故障转移由 gateway engine 负责。无图片结果必须失败，不能存为成功的空任务。
- 记录 Responses 的 token 用量与实际图片张数；网关图片配额仍以 image_count 结算。
- 回滚：删除新格式配置即可恢复 Images；不修改数据库结构或自动改模型数据。
