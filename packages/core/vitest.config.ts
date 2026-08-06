import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const coreSrc = fileURLToPath(new URL("./src/", import.meta.url));
const dbSrc = fileURLToPath(new URL("../db/src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@/auth", replacement: fileURLToPath(new URL("./src/auth.ts", import.meta.url)) },
      { find: "@/db/schema/pg", replacement: `${dbSrc}schema.ts` },
      { find: /^@\/db\//, replacement: dbSrc },
      { find: /^@\/lib\//, replacement: `${coreSrc}lib/` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
