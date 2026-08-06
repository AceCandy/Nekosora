import { defineConfig } from "eslint/config";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
