import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/db\//,
        replacement: fileURLToPath(new URL("../../packages/db/src/", import.meta.url)),
      },
      {
        find: /^@\/lib\//,
        replacement: fileURLToPath(new URL("../../packages/core/src/lib/", import.meta.url)),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("../../packages/core/src/", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
