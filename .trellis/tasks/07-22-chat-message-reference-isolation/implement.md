# 实施计划

1. 新增 conversation-scoped message lookup helper 与单测。
2. 替换 `/api/chat` parent/source/user/continue/parent-user/artifact 查询。
3. 新 user insert returning internal id，assistant parent 直接使用已验证 id。
4. 对非法引用/role 在生成前返回统一 400。
5. rg 清除 route 中裸 message publicId/id 查询，运行目标测试、lint、typecheck。
6. 全量测试、生产构建、diff check，更新 chat 状态/安全规范。
