# 架构审计加固路线图

## Goal

将 2026-08-10 架构审计中已确认且可由仓库内改动解决的问题，按风险、依赖和可回滚边界拆成独立子任务，逐个规划、审批、实现和验收。

## Background

- 当前 Web、Gateway、Worker、Core、DB、Queue 分层总体清晰，现有 `pnpm check` 与 `pnpm test` 基线通过。
- 本路线图只收录已有代码证据支持的问题，不把部署外部可能存在的 WAF、手工索引或 branch protection 当成仓库保证。
- 产品当前暂时只支持亮色主题；无条件移除 `dark` class 不属于缺陷，本路线图不恢复暗色主题，也不清理保留的暗色 token。
- 父任务只维护顺序、边界和最终集成门禁，不直接承载业务代码实现。

## Requirements

- R1. 每个子任务必须能够独立规划、验证和回滚，任何时刻只激活一个实现子任务。
- R2. 执行顺序优先保证内容安全和网关资源边界，其次处理故障策略与鉴权热路径，最后处理平台门禁、数据增长和前端规模风险。
- R3. 不改变现有 `/v1/*` 协议兼容、会话/分享属主隔离、模型目录事实源和客户端取消传播语义，除非所属子任务的最终方案明确说明并获得审批。
- R4. 数据库变更必须提供 PostgreSQL 迁移、Drizzle journal/snapshot、迁移前数据预检、回滚说明和约束测试。
- R5. 每个子任务完成前必须运行定向测试、`pnpm check`、`pnpm test`，并接受一次独立复核；需要真实基础设施或浏览器验证时不得用静态检查冒充通过。
- R6. 相关 README、SECURITY 和 `.trellis/spec/` 应由拥有行为变更的子任务同步，避免另建无所有者的文档补丁。

## Task Map

| 顺序 | 子任务 | 优先级 | 主要结果 |
|---|---|---|---|
| 1 | `08-10-generated-content-rendering-safety` | P1 | 保留管理员受信 custom，补风险提醒并隔离模型 artifact |
| 2 | `08-10-provider-timeout-enforcement` | P1 | 连接、读取和流空闲超时进入真实请求链路 |
| 3 | `08-10-gateway-request-governance` | P1 | 按 API Key 限流、并发保护与配额边界 |
| 4 | `08-10-circuit-breaker-fallback-hardening` | P2 | 用受控恢复探测替代无界 fail-open |
| 5 | `08-10-api-key-data-path-hardening` | P2 | 索引、最小字段投影和父子 Key 完整性 |
| 6 | `08-10-ci-artifact-quality-gates` | P2 | PR 门禁和三类生产制品构建验证 |
| 7 | `08-10-observability-growth-controls` | P2 | 指标标签基数与执行记录保留治理 |
| 8 | `08-10-chat-navigation-client-load` | P2 | 会话导航有界加载与客户端负载实测治理 |

## Acceptance Criteria

- [x] 八个子任务均有收敛后的 PRD；复杂子任务在激活前另行完成 `design.md` 与 `implement.md`。
- [x] 子任务严格按 Task Map 顺序逐个完成，没有跨任务半成品接口或长期兼容层。
- [x] 所有 P1 安全与资源边界均有可执行回归测试；产品明确保留的风险必须记录信任前提、提醒方式和剩余影响。
- [ ] 数据库、CI、观测与前端任务分别提供与其风险相称的迁移、回滚和验证证据。
- [x] 最终集成复核确认协议兼容、鉴权、分享、取消、故障转移和观测链路未被破坏。

## Final Integration Review

- 八个子任务均已按 Task Map 顺序归档，完成时间从 2026-08-10 至 2026-08-13；复杂任务均保留 `design.md` 与 `implement.md`。
- 当前仓库 `pnpm check`、`pnpm test` 与 Web 生产构建在最后一个子任务完成时通过。GitHub `Quality` workflow 也存在成功的 push/PR 运行记录。
- 内容安全任务保留管理员主动启用 custom renderer 后的未净化 HTML/脚本风险；信任前提、非阻断提醒和聊天/分享影响已写入 SECURITY 与代码规范。
- Gateway 治理旧 PRD 未回填验收框，但历史会话、journal 与工作提交 `22e6332` 共同记录了 `pnpm check/test/build/build:gateway`、1,533 项测试、PostgreSQL 治理并发 11/11 和独立复核通过；这是记录遗漏，不是实现阻塞。
- Chat 导航除登录态浏览器回归外均通过；受保护 Sidebar 的桌面与 390px 加载更多、深链、键盘和移动抽屉仍未实测。
- 最后一个子任务完成后再次通过全仓 `pnpm check`、`pnpm test` 与 Web 生产构建；结合各子任务的协议、鉴权、分享、取消、故障转移和低基数观测回归，最终仓库内集成复核通过。
- 唯一未完成项是 Chat 登录态浏览器验收，因此父任务保持 active，不归档。

## Out Of Scope

- 在父任务中直接实现任一子任务。
- 恢复暗色主题或清理暂未使用的暗色样式。
- 替换 Next.js、Fastify、PostgreSQL、Drizzle、pg-boss、AI SDK 或现有部署拓扑。
- 把外部基础设施能力未经核验地视为仓库内问题已经解决。
