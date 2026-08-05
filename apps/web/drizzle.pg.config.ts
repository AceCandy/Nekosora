import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const envFile = fileURLToPath(new URL("../../.env.local", import.meta.url));

if (!process.env.DATABASE_URL && existsSync(envFile)) {
  loadEnvFile(envFile);
}

// PostgreSQL 迁移配置。配合 pgvector 扩展。
// 运行:pnpm db:generate:pg  /  pnpm db:migrate:pg
export default defineConfig({
  schema: fileURLToPath(new URL("./src/db/schema/pg.ts", import.meta.url)),
  out: `${workspaceRoot}/drizzle/pg`,
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Better Auth 的表由其 CLI 自管;这里只管 Nekusora 业务表。
  verbose: true,
  strict: true,
});
