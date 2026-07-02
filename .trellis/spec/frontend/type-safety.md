# Type Safety

> Nekusora 类型安全约定。

---

## Overview

- 类型系统：TypeScript（strict）。Next.js / React 19 类型。
- 校验库：`zod`（v4）。用于请求体校验、env 解析、外部数据边界。
- DB 行类型：因 schema 同时支持 pg/sqlite 两种方言、表类型是联合，**统一收敛为 `Record<string, unknown>` / `any`**，在服务边界转成显式 DTO。

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

DB schema 文件（`src/db/schema/`、`src/db/auth-schema.ts`）是 drizzle 定义，不直接当运行时校验器。

---

## Common Patterns

**DB 行 `unknown` 收敛**：因 `getSchema()` 返回联合 schema，直接拿到的行是 `Record<string, unknown>`。统一处理方式：

```ts
// service / action 里：在返回边界断言成 DTO
const rows = await db.select().from(S().globalModels).where(...);
return rows as Record<string, unknown>[];

// 渲染层：unknown 不能作为 ReactNode，用 String() / as string 包裹
<span>{String(row.name as string)}</span>
```

`as any` 在 ORM schema 取用点（`const S = () => getSchema() as any`）是约定用法，必须配 `// eslint-disable-next-line @typescript-eslint/no-explicit-any`。

**显式 interface 定义 props**：组件 props 用具名 interface，不用 inline 对象类型；Server→Client 传数据确保可序列化（不传 Date / 函数）。

---

## Forbidden Patterns

- **不要给业务逻辑加 `any`**：仅 ORM schema 取用点（`getSchema() as any`）允许，其余 `any` 改用 `unknown` + 边界断言。
- **不要把 `unknown` 直接插值进 JSX**：会报「`unknown` 不能作为 ReactNode」。用 `String(x)` 或显式断言。
- **不要在多个地方重复定义同一 DTO**：DTO 由所属 service 唯一导出，其他地方 `import` 复用。
- **不要用 zod 校验内部数据流**：校验只在信任边界（外部输入）做一次。
