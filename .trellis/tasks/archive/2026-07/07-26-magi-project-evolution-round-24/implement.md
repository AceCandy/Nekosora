# 实施计划

## 1. 失败先行测试

- 新增 session 鉴权测试，证明 disabled/missing status 当前会被错误放行，并断言权威 session 参数。
- 新增 API key owner 状态测试，证明 enabled key 当前未约束所属用户。
- 新增 seed 凭据策略测试，覆盖生产弱默认拒绝和开发兼容。
- 扩展 instrumentation/worker 测试，证明环境校验在 DB/queue 前执行。

验证：新增测试在生产改动前按预期失败，失败原因对应各自缺口。

## 2. 共享鉴权边界

- 在 Better Auth 注册只读 `user.status` additional field。
- `getSession` 强制权威读取并对 status 失败关闭。
- `verifyKey` 候选查询 inner join active user，保留 enabled/hash/lastUsedAt 语义。

验证：session/key 聚焦测试、现有 chat/v1 route 回归通过。

## 3. 启动与 Seed 安全

- 增加 bootstrap/seed 共用的纯 seed 凭据解析器，并在空库检查后调用。
- 更新 `.env.example` 与 README 的生产密码要求。
- Next Node instrumentation 和 worker 在业务初始化前调用 `validateEnv`，保持 Edge return 与变量路径动态 import。

验证：env/seed/instrumentation/worker/bootstrap 聚焦测试通过，`pnpm build` 保护 Edge 边界。

## 4. 规范与独立复核

- 更新 backend auth guideline，记录 status additional field、权威 session、API key owner status 与生产 seed 契约。
- 独立审查两条授权链、启动顺序、生产/开发矩阵和测试是否存在失败开放。

## 5. 完整门禁

```bash
pnpm check
pnpm test
pnpm build
python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-24
git diff --check
```

本轮不启动开发服务、不运行真实 seed、不修改数据库数据。
