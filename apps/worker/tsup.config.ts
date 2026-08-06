import { resolve } from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  noExternal: [/^@nekusora\//],
  skipNodeModulesBundle: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  esbuildOptions(options) {
    options.alias = {
      "@/auth": resolve(import.meta.dirname, "../../packages/core/src/auth.ts"),
      "@/db/schema/pg": resolve(import.meta.dirname, "../../packages/db/src/schema.ts"),
      "@/db": resolve(import.meta.dirname, "../../packages/db/src"),
      "@/lib": resolve(import.meta.dirname, "../../packages/core/src/lib"),
      "@": resolve(import.meta.dirname, "../../packages/core/src"),
    };
  },
});
