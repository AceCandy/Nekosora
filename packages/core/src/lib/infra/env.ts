/**
 * 环境变量集中校验。启动时调用 validateEnv(),缺关键变量给出清晰错误。
 * 非必填项(降级项)只记录当前模式,不阻断。
 */
export interface EnvInfo {
  hasRedis: boolean;
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
    hasRedis: !!process.env.REDIS_URL,
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
  const rawStorage = (process.env.STORAGE_DRIVER ?? "").toLowerCase().trim();
  const remoteStorage = rawStorage === "s3" || rawStorage === "r2" || rawStorage === "minio";

  // 必填
  if (!process.env.DATA_ENCRYPTION_KEY) {
    errors.push("DATA_ENCRYPTION_KEY 未配置(用于加密 provider 密钥)。");
  } else if (!/^[0-9a-fA-F]{64}$/.test(process.env.DATA_ENCRYPTION_KEY)) {
    errors.push("DATA_ENCRYPTION_KEY 必须是 64 位十六进制。");
  }
  if (!process.env.BETTER_AUTH_SECRET) {
    errors.push("BETTER_AUTH_SECRET 未配置。");
  }
  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL 未配置(仅支持 PostgreSQL)。");
  }

  if (rawStorage && rawStorage !== "local" && !remoteStorage) {
    errors.push("STORAGE_DRIVER 仅允许 local、s3、r2 或 minio。");
  }
  if (remoteStorage) {
    for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!process.env[name]?.trim()) errors.push(`${name} 未配置。`);
    }
  }

  if (errors.length > 0) {
    throw new Error("环境变量校验失败:\n  - " + errors.join("\n  - "));
  }
  return info;
}
