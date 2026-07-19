# 审计并安全升级项目依赖

## Goal

审计 npm/pnpm 依赖中的已知漏洞与过期版本，在不扩大业务改动范围的前提下应用可验证、可回滚的安全升级，并明确记录未升级项及原因。

## Background

- 项目是 Node.js `>=22`、pnpm `10.22.0` 的单包 Next.js 15 / React 19 应用。
- 初始工作树干净，直接依赖只由根 `package.json` 与 `pnpm-lock.yaml` 管理。
- `pnpm audit --json` 基线为 5 个漏洞：1 个 high、4 个 moderate。
- high 漏洞为 `drizzle-orm@0.39.3` 的 SQL 标识符转义问题，修复版本为 `0.45.2`。
- moderate 漏洞分别来自 `drizzle-kit` 的旧 `esbuild`、`react-syntax-highlighter` 的旧 `prismjs`，以及 Next 15 固定依赖的旧 `postcss`。
- `next@15.5.20` 仍固定依赖 `postcss@8.4.31`，仅升级 Next 不能消除该漏洞。

## Requirements

- 升级 `pnpm outdated --format json` 报告中仍处于当前主版本的直接依赖，版本以审计时 registry 返回的稳定最新版本为准。
- 为消除已知漏洞，配套升级 `drizzle-orm` / `drizzle-kit` 和 `react-syntax-highlighter`；仅在现有 API 用法不要求业务代码迁移时保留升级。
- 使用定向 pnpm override 将 `next>postcss` 指向已修复的 8.5 系列，避免全局覆盖无关依赖。
- 更新 `package.json` 和 `pnpm-lock.yaml`，不修改业务行为或新增依赖。
- 重新运行漏洞审计、测试、lint 与类型检查；失败时区分升级回归与项目基线问题。
- 记录未应用的主版本升级及具体跳过原因。

## Acceptance Criteria

- [x] `package.json` 只包含本任务需要的依赖版本与定向 override 改动。
- [x] `pnpm install --frozen-lockfile` 成功，证明清单与锁文件一致。
- [x] `pnpm audit --json` 不再报告当前 5 个基线漏洞；若 registry 新增无可用安全修复的漏洞，必须单独说明。
- [x] `pnpm test` 通过。
- [x] `pnpm check` 通过；若仓库脚本自身不可执行，需给出真实错误并至少单独运行可用的类型检查。
- [x] 独立复核最终 diff，确认没有业务代码、迁移文件或生成资产的无关变化。

## Out of Scope

- Next 16、ESLint 10、TypeScript 7 等框架/工具链大版本迁移。
- `cache-manager` / `@keyv/redis`、`pg-boss` 等需要外部服务或持久化队列验证的主版本升级。
- React Markdown、Shiki、Lucide 等需要更宽 UI 回归或当前未形成必要收益的主版本升级。
- 运行数据库迁移、连接生产服务或修改应用业务代码来适配高风险升级。
