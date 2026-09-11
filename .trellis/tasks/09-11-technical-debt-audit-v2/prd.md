# 第二轮技术债审计与收敛

## Goal

基于当前代码建立有证据的技术债清单，分批实施并独立验证

## Requirements

- 覆盖 apps、packages、scripts 与 CI 配置；排除 docs/cankao、生成目录、密钥与本地调试数据。
- 每个发现记录源码位置、实际影响、最小修复范围、验证方式，区分已确认与待验证。
- 保持行为、协议和数据兼容；不新增框架或依赖，不为清零指标机械消除 any。
- 按独立验收范围建立子任务；规划确认后实施，实施后独立复核。

## Acceptance Criteria

- [x] 形成有源码锚点的分级审计报告及排除项（audit.md D1–D6）。
- [x] 建立可独立执行、验证和回滚的子任务。
- [x] 批次实施通过针对性测试、pnpm check 与 pnpm test。
- [x] 最终独立审阅、记录未验证项及剩余风险。

## Notes

- 上一轮质量门禁、数据库类型、Core 包边界、聊天 SSE 已完成，不重复改造。
- 正常兼容入口与未执行的真实环境验收不能直接认定为代码缺陷。

## Task Map
- D6 → 09-11-pg-test-coverage。
- D1/D2 → 09-11-http-input-boundaries。
- D3 → 09-11-route-repository-types。
- D4/D5 → 09-11-chat-read-model-types。

## Scope And Acceptance Boundary
本轮完成条件仅覆盖 audit.md D1–D6；其他领域 schema any 和页面静默降级保留为已记录后续项。合法请求与权限、缓存、数据库结构保持不变。用户已于 2026-09-11 批准实施，D1–D6 已完成代码与验证；尚未提交或归档。
