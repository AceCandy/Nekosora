import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // 统一工作区依赖实例，让项目级 vi.mock 命中共享服务依赖。
    dedupe: ["better-auth", "@nekusora/db"],
    alias: [
      { find: "@shared", replacement: fileURLToPath(new URL("./src/shared/", import.meta.url)) },
      { find: "@features", replacement: fileURLToPath(new URL("./src/features/", import.meta.url)) },
      { find: "@", replacement: src },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
