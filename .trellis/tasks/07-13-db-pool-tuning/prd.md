# 调大应用层 PG 连接池上限

## Goal

将 `src/lib/infra/db` 的 `node-postgres` Pool `max`(当前硬编码 10)调大并通过环境变量配置,缓解并发请求下连接耗尽。**纯应用层改动,不上 pgbouncer。**

## Background

`src/lib/infra/db/index.ts:57` `new Pool({ connectionString: url, max: 10 })`。

段A(`prepareChatContext`)单次对话上下文准备就有多次 DB 查询(知识库 fileIds / vision 模型能力 / 用户设置 / 已有消息 / output mode / template / cards),叠加段C落库 + pg-boss 队列自身用同一 PG,`max:10` 在并发 10+ 请求时即排队等连接,是当前**最高优先级瓶颈**。

## Requirements

- Pool `max` 通过环境变量 `DB_POOL_MAX` 配置
- 缺省值调高(具体值在 design 按预算确定,候选 20),带注释说明取舍依据
- `.env.example` 增补 `DB_POOL_MAX` 及说明
- 连接池生命周期行为不变(`closeDb` 的 in-flight guard / end 逻辑不动)

## Constraints

- **多进程总连接预算**:Next.js 主进程与 `pnpm worker` 各自持有独立 Pool,总连接数 = 各进程 max 之和,不得超过 PG `max_connections` 减去其他客户端(如 drizzle studio / 运维连接)的余量。缺省值需保守。
- 可逆:`DB_POOL_MAX` 可随时调回,不强制迁移。
- 不上 pgbouncer(独立任务)。

## Acceptance Criteria

- [ ] `DB_POOL_MAX` 环境变量生效;不配置时走保守缺省值,应用正常启动
- [ ] `.env.example` 补充 `DB_POOL_MAX` 说明(含"按 PG max_connections 余量调整"引导)
- [ ] `closeDb` / 连接池初始化的 in-flight guard 行为不变
- [ ] `pnpm typecheck` / `pnpm lint` 通过
- [ ] 注释写清多进程总连接预算的考量

## Notes

- 实际 PG `max_connections` 因部署而异,prd 用"不超预算"约束;实现给保守缺省 + 注释引导运维按规格调整。
- 此任务为 lightweight,PRD-only 即可;若缺省值论证复杂,补一份简短 design。
