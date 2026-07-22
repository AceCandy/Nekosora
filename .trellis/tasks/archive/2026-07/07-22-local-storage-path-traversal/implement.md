# 实施计划

1. 扩展上传 route 测试，先复现 POSIX/Windows traversal filename 与控制字符名称。
2. 在上传 route 内实现最小 filename 清洗，统一 storage/DB/response 三处使用。
3. 扩展 LocalDriver 测试，先证明相对 `../` 可越界写入/读取/删除。
4. 在 `resolveKey` 增加相对 key root containment；保留绝对路径直通。
5. 运行目标测试、lint、typecheck，复核所有 LocalDriver 操作都经 `resolveKey`。
6. 运行全量测试、生产构建与 `git diff --check`，更新 file-storage 规范。
