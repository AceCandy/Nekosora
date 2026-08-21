import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvInfo, validateEnv } from "./env";

const DATA_KEY = "a".repeat(64);
const AUTH_SECRET = "auth-secret-must-not-leak";
const DATABASE_URL = "postgresql://env-user:env-password@localhost:5432/env-test";
const S3_VALUES = {
  S3_BUCKET: "private-bucket-must-not-leak",
  S3_ACCESS_KEY_ID: "access-key-must-not-leak",
  S3_SECRET_ACCESS_KEY: "secret-key-must-not-leak",
} as const;

function stubRequiredEnv(): void {
  vi.stubEnv("DATA_ENCRYPTION_KEY", DATA_KEY);
  vi.stubEnv("BETTER_AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("DATABASE_URL", DATABASE_URL);
}

function stubRemoteStorage(driver: "s3" | "r2" | "minio"): void {
  vi.stubEnv("STORAGE_DRIVER", driver);
  for (const [name, value] of Object.entries(S3_VALUES)) vi.stubEnv(name, value);
}

describe("storage environment validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["", "local"])("STORAGE_DRIVER=%j 保持 local", (driver) => {
    stubRequiredEnv();
    vi.stubEnv("STORAGE_DRIVER", driver);

    expect(getEnvInfo().storageDriver).toBe("local");
    expect(validateEnv().storageDriver).toBe("local");
  });

  it.each(["s3", "r2", "minio"] as const)("STORAGE_DRIVER=%s 接受完整远端配置", (driver) => {
    stubRequiredEnv();
    stubRemoteStorage(driver);

    expect(validateEnv().storageDriver).toBe(driver);
  });

  it("拒绝非空且不支持的 STORAGE_DRIVER", () => {
    stubRequiredEnv();
    vi.stubEnv("STORAGE_DRIVER", "ftp");
    for (const [name, value] of Object.entries(S3_VALUES)) vi.stubEnv(name, value);

    expect(validateEnv).toThrow("STORAGE_DRIVER 仅允许 local、s3、r2 或 minio");
  });

  it.each(Object.keys(S3_VALUES) as Array<keyof typeof S3_VALUES>)(
    "远端存储缺少 %s 时只报告变量名",
    (missingName) => {
      stubRequiredEnv();
      stubRemoteStorage("s3");
      vi.stubEnv(missingName, " ");

      let error: unknown;
      try {
        validateEnv();
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(`${missingName} 未配置`);
      for (const value of Object.values(S3_VALUES)) expect(message).not.toContain(value);
      expect(message).not.toContain(AUTH_SECRET);
      expect(message).not.toContain(DATABASE_URL);
    },
  );
});
