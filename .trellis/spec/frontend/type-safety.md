# Type Safety

> Nekusora 类型安全约定。

---

## Overview

- 类型系统：TypeScript（strict）。Next.js / React 19 类型。
- 校验库：`zod`（v4）。用于请求体校验、env 解析、外部数据边界。
- DB 行类型：保留实际 Drizzle Schema 与查询投影的推断；服务边界需要稳定契约时映射为 DTO，不统一擦除为 `Record<string, unknown>` / `any`。

---

## Type Organization

- **跨特性 DTO**：领域服务在 `lib/<domain>/service.ts` 内定义并导出 `interface`（如 `RenderStyle`），作为该域的稳定契约。
- **特性内部类型**：放 `features/<x>/model/types.ts`（如 `ChatMessage`、`ToolCallRecord`）。
- **API 错误类型**：集中 `lib/errors.ts`（`ErrorCode` 枚举 + `ErrorType`）。
- **共享工具类型**：`shared/lib/types.ts`。

---

## Validation

**zod 用于边界校验**：

- 外部输入（API 请求体、Server Action 入参、env 变量）用 zod schema 解析，失败抛 `REQUEST_INVALID_JSON` 等约定错误码。
- 内部数据不重复校验。

DB schema 文件（`packages/db/src/schema.ts`，含 Better Auth 表）是 drizzle 定义，不直接当运行时校验器。

---

## Common Patterns

**保留 DB 查询推断**：`getSchema()` 返回实际 PostgreSQL Schema，必须在 `await getDb()` 后访问。

```ts
// service / action 内推断 id、name 的实际列类型。
const db = await getDb();
const s = getSchema();
const rows = await db.select({ id: s.apiKeys.id, name: s.apiKeys.name }).from(s.apiKeys);
return rows;
```

不要新增 `getSchema() as any` 或手写宽泛行类型覆盖推断。历史强转分批收敛，不作为新代码模板；真正的外部 `unknown` 在信任边界校验后使用。

**显式 interface 定义 props**：组件 props 用具名 interface，不用 inline 对象类型；Server→Client 传数据确保可序列化（不传 Date / 函数）。

---

## Forbidden Patterns

- **不要给业务逻辑或 ORM schema 加 `any`**：内部数据优先推断；外部未知数据用 `unknown` + 边界校验。
- **不要把 `unknown` 直接插值进 JSX**：会报「`unknown` 不能作为 ReactNode」。用 `String(x)` 或显式断言。
- **不要在多个地方重复定义同一 DTO**：DTO 由所属 service 唯一导出，其他地方 `import` 复用。
- **不要用 zod 校验内部数据流**：校验只在信任边界（外部输入）做一次。
