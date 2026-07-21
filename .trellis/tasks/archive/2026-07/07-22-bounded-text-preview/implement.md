# 实施计划

1. 新增纯逻辑 Range 解析测试，逐个完成明确区间、开放结尾、suffix、非法/越界行为。
2. 新增 `http-range.ts` 最小解析实现，返回闭区间或 `null`。
3. 扩展 StorageDriver 可选 GetOpts；为 LocalDriver 和 S3Driver 建立有界/全量读取回归测试后实现。
4. 为文件 GET 端点新增公共 HTTP 行为测试，再接入 Range 解析与 storage 有界读取。
5. 修改 PreviewText 多取 1 字节、按字节截断并补 `t` effect 依赖。
6. 运行相关测试、lint、typecheck、全量测试与 `git diff --check`。
7. 独立复核跨层数据流、S3 重定向、鉴权、不受影响调用方及临时产物。
