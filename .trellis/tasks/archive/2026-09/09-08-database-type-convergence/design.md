# 数据库类型收敛设计

## 边界与事实来源

`packages/db/src/schema.ts` 继续作为表结构事实来源。`packages/db/src/index.ts` 使用
`typeof import("./schema")`、`NodePgDatabase<Schema>` 与实际 `Pool` 类型描述现有对象，
保留 `$client`。不生成第二份表接口，不引入仓储框架，不增设另一条获取连接的方法。
`packages/core/src/lib/infra/db/index.ts` 维持既有转发；仅在确需共享类型时导出少量 type。

运行时仍按 `getDb -> loadSchema -> 动态加载 pg/Drizzle -> 初始化单一 Pool` 执行。
Schema 初始化前抛错、并发单飞、初始化失败清理 promise、close 等待初始化与清理对象的
顺序保持不变。类型声明不能变成驱动或 Schema 的静态运行时 import。

## 直接调用方

- 事务回调优先移除错误的 `tx: typeof db`，由 Drizzle 推断事务对象；事务不应被要求拥有 Pool 的 `$client`。
- Schema 的二次 `as any` 只在本批直接影响的查询链中消除。查询结果优先推断，删除遮蔽实际字段的手写回调类型，不删除字段来迎合类型。
- `ownedWhere` 的时钟是实际 SQL 表达式；`bucketExpr` 保留返回 SQL 别名的推断。SQL 文本、参数、锁顺序和时间来源不动。
- 分享限流保留小接口，但查询参数限定为实际支持的 SQL 输入，异步返回兼容 Drizzle 查询对象；测试继续使用现有 Mock，不为测试扩大生产契约。
- 当前诊断涉及 Core 的 title、keys、instruction-cards、RAG processing、usage aggregate，以及 Web 的 backfill 脚本、branch/conversations/share 链、panel keys 查询链。实施时先消除这些链上的类型擦除再检查传播结果；遇到业务语义冲突停止扩展。

## 验证与回滚

复用 Core Vitest 增加 `src/lib/infra/db/index.test.ts`，通过 Mock 验证连接工厂生命周期，
通过类型断言确保公共入口和关键表类型没有退化。DB 包暂不增加测试依赖或脚本。
现有标题事务、分支、分享限流、密钥、RAG 租约与统计测试作为行为回归。

本批不需要数据迁移；回滚为代码和配套规范提交回滚。真实 PG、Edge/Node 生产构建仍是独立
验证边界；未执行时明确报告，不能把静态类型通过当成这些环境的验证。
