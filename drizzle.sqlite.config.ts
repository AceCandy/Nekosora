import { defineConfig } from "drizzle-kit";

// SQLite 回退迁移配置。配合 sqlite-vec 扩展(通过 better-sqlite3 加载)。
// 运行:pnpm db:push:sqlite(SQLite 单文件库用 push 比生成迁移更省心)
export default defineConfig({
  schema: "./src/db/schema/sqlite.ts",
  out: "./drizzle/sqlite",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SQLITE_PATH ?? "./data/local.db",
  },
  verbose: true,
  strict: true,
});
