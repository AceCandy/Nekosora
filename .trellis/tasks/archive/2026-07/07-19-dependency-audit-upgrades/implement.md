# 执行计划

1. 记录升级前 `pnpm test` 与 `pnpm check` 基线，区分既有失败与升级回归。
2. 显式升级当前主版本内的过期直接依赖；验证 `package.json` diff 只涉及目标版本。
3. 升级漏洞修复依赖：Drizzle ORM/Kit、react-syntax-highlighter，并添加 `next>postcss` 定向 override。
4. 运行 `pnpm install --frozen-lockfile`，检查目标依赖与传递依赖的实际版本。
5. 运行 `pnpm audit --json`、`pnpm test`、`pnpm check`；对失败做最小范围定位和回退。
6. 独立复核 `git diff`、`pnpm outdated` 与审计结果，整理已升级和跳过项。

## Validation Commands

```bash
pnpm install --frozen-lockfile
pnpm audit --json
pnpm test
pnpm check
pnpm outdated --format json
git diff --check
git diff -- package.json pnpm-lock.yaml
```

## Rollback Points

- 依赖升级前保留干净基线；不使用破坏性 Git 命令。
- 每类升级通过显式版本列表执行，失败时只反向调整对应清单项并重新生成锁文件。
- 不保留 pack、审计导出或本地调试临时文件到仓库。
