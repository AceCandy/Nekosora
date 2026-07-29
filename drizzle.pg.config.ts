import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

// PostgreSQL 迁移配置。配合 pgvector 扩展。
// 运行:pnpm db:generate:pg  /  pnpm db:migrate:pg
export default defineConfig({
  schema: "./src/db/schema/pg.ts",
  out: "./drizzle/pg",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Better Auth 的表由其 CLI 自管;这里只管 Nekusora 业务表。
  verbose: true,
  strict: true,
});
