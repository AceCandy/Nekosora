# 存储与 readiness 收紧设计

## Storage Selection

- `resolveStorageKind` 明确区分空值/`local`、合法远端 driver、非法非空值。
- `validateEnv` 在远端 driver 下校验 bucket、access key、secret key；错误只报告变量名。
- `buildStorage` 删除 catch-to-local；远端构造错误原样向调用方传播。
- LocalDriver 的默认路径与 Docker 显式 `LOCAL_STORAGE_DIR` 保持不变。

## Readiness Concurrency

- 数据库、存储、队列各保留一个原始 in-flight promise。
- 对外仍通过现有 2 秒 timeout 返回；超时不清除尚未完成的原始 promise。
- 后续探针复用同一 promise，底层完成后在 `finally` 清空，允许下一轮检查。
- 该单飞边界不伪造第三方取消能力，同时把最坏悬挂数限制为每类依赖一个。

## Compatibility

- readiness JSON 和 HTTP 状态不变。
- 本地开发默认配置不变；只有显式错误配置从静默 local 改为失败。
