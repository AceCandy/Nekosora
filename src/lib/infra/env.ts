/**
 * 环境变量集中校验。启动时调用 validateEnv(),缺关键变量给出清晰错误。
 * 非必填项(降级项)只记录当前模式,不阻断。
 */
import { dbDialect } from "@/lib/infra/db";

export interface EnvInfo {
  dbDialect: "pg" | "sqlite";
  hasRedis: boolean;
  queueAvailable: boolean;
  storageDriver: "local" | "s3" | "r2" | "minio";
  appUrl: string;
  skPrefix: string;
  skRandomLength: number;
  isDev: boolean;
}

export function getEnvInfo(): EnvInfo {
  const rawStorage = (process.env.STORAGE_DRIVER ?? "").toLowerCase().trim();
  const storageDriver: EnvInfo["storageDriver"] =
    rawStorage === "s3" || rawStorage === "r2" || rawStorage === "minio" ? rawStorage : "local";
  return {
    dbDialect,
    hasRedis: !!process.env.REDIS_URL,
    queueAvailable: dbDialect === "pg",
    storageDriver,
    appUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    skPrefix: process.env.SK_PREFIX ?? "sk-",
    skRandomLength: Number(process.env.SK_RANDOM_LENGTH ?? 48),
    isDev: process.env.NODE_ENV !== "production",
  };
}

/** 启动时校验关键环境变量。dev 模式宽松(允许弱 key 占位),prod 严格。 */
export function validateEnv(): EnvInfo {
  const info = getEnvInfo();
  const errors: string[] = [];

  // 必填
  if (!process.env.DATA_ENCRYPTION_KEY) {
    errors.push("DATA_ENCRYPTION_KEY 未配置(用于加密 provider 密钥)。");
  } else if (!/^[0-9a-fA-F]{64}$/.test(process.env.DATA_ENCRYPTION_KEY)) {
    errors.push("DATA_ENCRYPTION_KEY 必须是 64 位十六进制。");
  }
  if (!process.env.BETTER_AUTH_SECRET) {
    errors.push("BETTER_AUTH_SECRET 未配置。");
  }

  // PG 模式额外要求
  if (info.dbDialect === "pg" && !process.env.DATABASE_URL) {
    errors.push("DB_DIALECT=pg 但未配置 DATABASE_URL。");
  }

  if (errors.length > 0) {
    throw new Error("环境变量校验失败:\n  - " + errors.join("\n  - "));
  }
  return info;
}
