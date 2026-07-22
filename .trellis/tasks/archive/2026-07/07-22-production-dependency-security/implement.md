# 实施计划

1. 保留审计红灯：3 high，fast-uri 3.1.2 与 Next 嵌套 sharp 0.34.5。
2. 在 `pnpm.overrides` 增加精确 fast-uri 与 scoped Next sharp override。
3. 运行 `pnpm install --lockfile-only` 更新 lockfile，核对 diff 只涉及解析结果。
4. 运行 `pnpm why`、lockfile 搜索与 Node sharp 加载验证实际版本。
5. 重跑生产 audit；若仍有 high/critical，回到依赖树定位。
6. 运行 lint、typecheck、全量测试、`pnpm build` 与 `git diff --check`。
7. 独立复核顶层版本、锁文件范围、缓存/临时产物和剩余 moderate 风险。
