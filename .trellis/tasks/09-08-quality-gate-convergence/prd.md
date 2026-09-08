# 质量门禁与失真规范收敛

## Goal

让项目质量检查覆盖生产代码与测试，阻止新增警告被静默接受，并使目录规范准确描述当前实现。

## 已确认事实

- `packages/core/tsconfig.json`、`apps/web/tsconfig.json` 排除了 `.test.ts`；只读纳入后分别出现 56、15 条诊断。`packages/queue/tsconfig.json` 也存在相同排除。
- 当前 lint 有 12 条警告，其中 11 条在协议测试，1 条为协议解析器未用 import。
- `apps/web/src/features/README.md` 与 `.trellis/spec/backend/directory-structure.md` 仍描述已完成的特性、Worker 和队列目录迁移。
- 用户已批准上一轮审计顺序，并先实施质量门禁与失真规范收敛。

## Requirements

- R1：现有 TypeScript 测试进入所属包的常规类型检查，保留 strict；修复测试夹具、签名和类型收窄，不能删断言或弱化业务接口来通过检查。
- R2：现有 lint 警告清零，已提供 lint 的包新增警告时命令必须失败。
- R3：修正已失真的目录、包职责和质量规范；描述现状与明确的门禁，不引入新架构。
- R4：保持运行时与数据库行为不变，不改包依赖，不做数据库类型改造或聊天 Store 重构。

## Acceptance Criteria

- [x] Core、Web、Queue 以及原已覆盖测试的 Gateway、Worker 常规类型检查覆盖全部现有 TS/TSX 测试。
- [x] `pnpm check` 通过且 lint 零警告。
- [x] `pnpm test` 通过，没有新增跳过、删除测试或弱化断言。
- [x] 文档路径、Worker 入口与队列契约所有者和磁盘代码一致。
- [x] 独立复核完成；报告未执行的集成、构建与浏览器验证。

验收结果见 `implement.md`。实现与验证已完成，提交、归档仍待用户确认。

## 范围外

数据库 Schema/迁移、框架和依赖升级、跨包导入迁移、聊天行为重构、页面设计、部署与推送。
