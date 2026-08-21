# 修复当前项目技术债

## Goal

修复本次审计中已确认、可复现的技术债，避免模型推理能力失真、关键数据库路径未测试、生产存储静默降级，以及前端与工程化问题继续积累。

## Background

- `drizzle/pg/0000_baseline.sql:753` 共包含 530 个模型；326 个声明 `reasoning=true`，其中 271 个缺少 `thinkingFormat`。
- `packages/core/src/lib/reasoning.ts:18` 会为缺少明确映射的推理模型生成默认档位，而 `packages/core/src/lib/reasoning.ts:80` 在缺少 `thinkingFormat` 时不会翻译请求。
- `packages/core/src/lib/sync-pi-models.ts:550` 的同步闸门未拒绝上述不完整能力包，`packages/core/src/lib/model-catalog.test.ts:146` 也未做全目录 invariant 检查。
- PostgreSQL 集成测试在缺少测试数据库环境变量时使用 `describe.skip`；`.github/workflows/quality.yml:32` 未提供测试数据库，因此关键路径在 CI 中未执行。
- `packages/core/src/storage/index.ts:63` 在对象存储初始化失败时静默回退本地磁盘；该行为可能改变生产数据持久性和多实例可见性。
- 已确认的其余候选包括 Modal 可访问名称与国际化、ImageStudio 状态同步与请求竞态、readiness 超时不取消底层操作、actionlint 平台不可移植、6 个无直接引用依赖和若干无调用内部导出。

## Requirements

- 覆盖本次审计确认的全部债务，按五个可独立验证、可独立回滚的子任务分批实施，高优先级问题先实施。
- 只修复本次审计中有代码或运行结果证据的问题，不扩大到无证据的重构。
- 模型目录修复不得根据模型名称猜测能力；模型语义必须以项目规则允许的官方资料或 pi 模型目录为依据。
- 模型目录数据变更必须提供 PostgreSQL 迁移，并同步 Drizzle journal、snapshot 和相关测试。
- 不得以静默跳过测试的方式让关键数据库路径在 CI 中显示成功。
- 只有未配置 `STORAGE_DRIVER` 或明确配置 `local` 时才允许使用本地存储；显式配置 `s3`、`r2` 或 `minio` 后，缺少必要配置或初始化失败必须报错，不得自动改变数据落点。
- 删除依赖或内部导出前必须确认没有静态调用、包导出或运行时 peer 需求。
- 不把不同风险面的改动混成一个不可审查提交。

## Acceptance Criteria

- [x] 最终范围内的每项债务都有对应代码变更或明确的“不应修改”证据。
- [x] 模型目录不再允许 `reasoning=true` 且缺少合法 `thinkingFormat` 的条目通过同步和测试闸门。
- [x] 模型能力修正对已有 PostgreSQL 数据可迁移，并保持 journal/snapshot 一致。
- [x] 纳入范围的 PostgreSQL 集成测试在 CI 中实际执行，无法执行时明确失败而非静默跳过。
- [x] 存储策略、前端行为和工程脚本修改均有最小可运行验证。
- [x] 删除依赖后相关构建与测试通过。
- [x] 最终独立复核未发现范围外改动。

## Child Tasks

- `08-21-fix-model-catalog-reasoning`：修复模型推理能力、同步闸门和数据迁移。
- `08-21-enable-ci-postgres-tests`：让 PostgreSQL 集成测试在 CI 中实际执行。
- `08-21-harden-storage-readiness`：取消远端存储静默降级并限制 readiness 悬挂操作。
- `08-21-fix-frontend-tech-debt`：修复 Modal、ImageStudio 与文本预览问题。
- `08-21-cleanup-tooling-dependencies`：修复 actionlint 可移植性并删除确认无用内容。

## Out of Scope

- 未经验证的新功能或模型能力扩展。
- 与本次审计无关的代码格式化、目录调整和相邻重构。
- 没有复现证据的性能优化。
