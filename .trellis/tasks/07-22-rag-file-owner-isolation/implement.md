# 实施计划

1. 为 retrieve options 增加必填 userId，把 owner/ragReady 放进 join query where，更新三类调用方。
2. 为知识库 file ID 收集增加 userId 条件并更新 WebChat/调试 API。
3. 为 context 输入增加 userId，过滤 fileRows，并只向 retrieve 传 owned IDs。
4. 为 multimodal 组装增加 userId owner 条件，同时修正 orchestrator 图片初筛。
5. 新增 retrieve、context、multimodal 安全回归测试，先红后绿。
6. 运行目标测试、lint、typecheck，独立追踪每条 ID 数据流。
7. 运行全量测试、生产构建与 `git diff --check`，更新 backend 文件存储/RAG 规范。
