# 修复生产依赖高危漏洞

## Goal

消除当前生产依赖树中的 3 个 high 安全告警，同时保持 Next 15.5.20、MCP SDK 1.29.0 与现有顶层依赖版本不变，并用生产构建证明 sharp override 可运行。

## Background

- `pnpm audit --prod --audit-level high` 退出码 1：4 moderate、3 high。
- `fast-uri 3.1.2` 经 `@modelcontextprotocol/sdk -> ajv` 引入，命中两个 host confusion advisory；审计要求 `>=3.1.4`。
- `next 15.5.20` 的 optional dependency 范围 `sharp ^0.34.3` 解析为 0.34.5，命中 libvips high advisory；项目已直接依赖并成功使用 `sharp 0.35.3`。

## Requirements

- R1：通过现有 `pnpm.overrides` 精确统一 `fast-uri` 到 3.1.4。
- R2：仅覆盖 `next@15.5.20` 的 sharp 到项目现有 0.35.3，不影响其他依赖选择。
- R3：同步更新 lockfile，不手工编辑 node_modules 或提交缓存/原生构建产物。
- R4：顶层依赖版本声明保持不变，不执行自动 audit fix 或主版本升级。
- R5：验证运行时实际依赖树不再包含 fast-uri 3.1.2 或 sharp 0.34.5。

## Acceptance Criteria

- [x] AC1：`pnpm audit --prod --audit-level high` 退出码 0，high/critical 为 0；剩余 moderate 单独记录。
- [x] AC2：`pnpm why`/lockfile 证明 fast-uri=3.1.4，Next 使用 sharp=0.35.3，旧漏洞版本不再解析。
- [x] AC3：Node 可加载 sharp 并报告 0.35.3。
- [x] AC4：lint、typecheck、全量测试、生产构建和 `git diff --check` 通过。
- [x] AC5：package.json 除两个精确 override 外无版本或脚本变化。
- [x] AC6：没有 registry 缓存、临时文件或服务进程残留。

## Out of Scope

- 修复 moderate advisory，除非它们随依赖重解自动消失。
- 升级 Next、MCP SDK、AJV 或其他顶层依赖。
- 修改应用业务代码或依赖 API 使用方式。
