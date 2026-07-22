# 阻止本地文件存储路径穿越

## Goal

阻止恶意 multipart filename 或伪造相对 storage key 让 LocalDriver 访问 `LOCAL_STORAGE_DIR` 之外的路径，同时保留历史绝对路径记录的读取兼容性。

## Background

- Node 24 的 `Request.formData()` 实测保留 `filename="../../../escape.txt"`，不会自动取 basename。
- 上传 route 直接构造 `${userId}/${fileId}-${file.name}`；足够多的 `../` 会在 `path.join` 归一化后越出 storage root。
- LocalDriver 的 `resolveKey` 对任何相对 key 直接 `join(root, key)`，put/get/delete/exists 均共享该风险。
- 旧 `file_objects.storagePath` 可能是绝对路径，现有实现显式承诺继续直接使用。

## Requirements

- R1：上传入口按 `/` 与 `\\` 同时切分 filename，仅保留 basename。
- R2：移除 basename 中的 NUL、ASCII 控制字符与首尾空白；空值、`.`、`..` 回退为 `file`。
- R3：安全文件名必须统一用于 storage key、DB filename 与响应 filename，避免展示名和存储名漂移。
- R4：LocalDriver 对相对 key 使用 `resolve + relative` 校验结果仍位于 root；越界统一抛 `storage_key_outside_root`。
- R5：put/get/delete 必须拒绝越界相对 key；exists 对越界 key 返回 false，且不得读取/删除外部文件。
- R6：绝对 key 保留现有直通行为，仅作为历史数据兼容；不得扩大到新上传路径。

## Acceptance Criteria

- [x] AC1：手工构造 `../../../escape.txt` 与 `..\\..\\escape.txt` 文件名时，上传只使用 `escape.txt`，storage key 无路径分隔片段。
- [x] AC2：控制字符/空文件名得到稳定安全名称，DB 与响应使用同一值。
- [x] AC3：LocalDriver put/get/delete 对 `../` 相对 key 抛 `storage_key_outside_root`，外部文件不被创建、读取或删除。
- [x] AC4：LocalDriver exists 对越界 key 返回 false；合法嵌套相对 key保持可读写。
- [x] AC5：历史绝对路径仍可读取，现有 Range 读取测试不回归。
- [x] AC6：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过，无临时文件或服务残留。

## Out of Scope

- 防御本地管理员预先在 storage root 内创建的恶意 symlink。
- 迁移或重写已有 DB filename/storagePath。
- 文件名长度、扩展名或 MIME 白名单策略。
