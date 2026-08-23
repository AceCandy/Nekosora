import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src/", import.meta.url));
const coreSrc = fileURLToPath(new URL("../../packages/core/src/", import.meta.url));
const dbSrc = fileURLToPath(new URL("../../packages/db/src/", import.meta.url));

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // Core 源码被直接 alias 进 Web 测试；统一依赖实例才能让项目级 vi.mock 生效。
    dedupe: ["better-auth", "@nekusora/db"],
    alias: [
      { find: "@/auth", replacement: `${coreSrc}auth.ts` },
      { find: "@/lib/session", replacement: `${src}lib/session.ts` },
      { find: "@/lib/auth-client", replacement: `${src}lib/auth-client.ts` },
      { find: "@/lib/output-modes/service", replacement: `${src}lib/output-modes/service.ts` },
      { find: "@/lib/render-styles/service", replacement: `${src}lib/render-styles/service.ts` },
      { find: "@/lib/settings-control/runtime", replacement: `${src}lib/settings-control/runtime.ts` },
      { find: "@/db/schema/pg", replacement: `${dbSrc}schema.ts` },
      { find: /^@\/db\//, replacement: dbSrc },
      { find: /^@\/lib\//, replacement: `${coreSrc}lib/` },
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
