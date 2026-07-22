# 本地存储路径穿越防护设计

## Defense Layers

```text
multipart File.name
  -> sanitizeUploadFilename
       slash/backslash basename
       remove NUL/control + trim
       empty/dot fallback
  -> userId/uuid-safeName (new relative key)
  -> LocalDriver.resolveKey
       absolute key -> legacy pass-through
       relative key -> resolve(root,key) + relative containment check
```

入口清洗保证新数据稳定可读；driver containment 是最终安全边界，覆盖伪造 DB key 和其他未来调用方。不能只依赖 filename 清洗。

## Containment Contract

对相对 key 计算 `resolved = resolve(root, key)` 与 `relative(root, resolved)`。结果等于 `..`、以 `..${sep}` 开头或仍是绝对路径时拒绝。该判断适配当前 OS 的路径分隔与盘符语义。

绝对 key 在 containment 前返回，保留旧记录兼容。新上传永远由 `userId/uuid-filename` 产生相对 key。

## Error / Rollback

越界抛普通 Error，message 固定 `storage_key_outside_root`；route 现有错误处理会返回内部失败，不暴露外部路径。回滚 filename 清洗与 containment 即可，无迁移。
