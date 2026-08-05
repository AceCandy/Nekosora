import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const workspaceEnv = resolve(import.meta.dirname, "../../.env.local");
if (existsSync(workspaceEnv)) loadEnvFile(workspaceEnv);

// next-intl 插件:自动处理 messages 加载和 SSR 国际化。
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  // Docker 自托管:输出 standalone 产物,简化镜像。
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  // 局域网联调:允许从开发机 IP 访问 next dev 的 /_next/* 资源,消除 dev 跨域告警。
  allowedDevOrigins: ["192.168.1.205", "localhost", "127.0.0.1"],
  // mem0ai 是大 bundle,内部动态 import 各 provider SDK(aws/azure/google/qdrant...);
  // 我们只用 pgvector+openai。标为 server external,构建时不打包其依赖图,运行时按需 require,
  // 避免 webpack 解析缺失的 peer provider SDK(如 @aws-sdk/client-bedrock-runtime)。
  serverExternalPackages: ["mem0ai", "pg", "pg-boss"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default withNextIntl(nextConfig);
