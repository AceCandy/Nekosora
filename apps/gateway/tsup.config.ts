import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  noExternal: [/^@nekusora\//],
  skipNodeModulesBundle: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
