import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../..", import.meta.url)));
process.env.DRIZZLE_MIGRATIONS_DIR = "drizzle/pg";
