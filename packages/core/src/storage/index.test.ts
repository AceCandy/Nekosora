import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetStorageForTest,
  getStorage,
  getStorageKind,
  resolveStorageKind,
} from "./index";

const REMOTE_VALUES = {
  S3_BUCKET: "factory-private-bucket",
  S3_ACCESS_KEY_ID: "factory-access-key",
  S3_SECRET_ACCESS_KEY: "factory-secret-key",
} as const;

function stubRemoteStorage(driver: "s3" | "r2" | "minio"): void {
  vi.stubEnv("STORAGE_DRIVER", driver);
  for (const [name, value] of Object.entries(REMOTE_VALUES)) vi.stubEnv(name, value);
}

describe("storage factory", () => {
  afterEach(() => {
    __resetStorageForTest();
    vi.unstubAllEnvs();
    vi.doUnmock("./s3");
    vi.resetModules();
  });

  it.each(["", "local"])("STORAGE_DRIVER=%j 构造 LocalDriver", async (driver) => {
    vi.stubEnv("STORAGE_DRIVER", driver);

    expect(resolveStorageKind()).toBeNull();
    await expect(getStorage()).resolves.toMatchObject({ kind: "local" });
  });

  it.each(["s3", "r2", "minio"] as const)("STORAGE_DRIVER=%s 构造对应远端 driver", async (driver) => {
    stubRemoteStorage(driver);

    expect(resolveStorageKind()).toBe(driver);
    await expect(getStorage()).resolves.toMatchObject({ kind: driver });
    expect(getStorageKind()).toBe(driver);
  });

  it("拒绝非空且不支持的 STORAGE_DRIVER", async () => {
    vi.stubEnv("STORAGE_DRIVER", "ftp");

    expect(resolveStorageKind).toThrow("STORAGE_DRIVER 仅允许 local、s3、r2 或 minio");
    await expect(getStorage()).rejects.toThrow("STORAGE_DRIVER 仅允许 local、s3、r2 或 minio");
  });

  it.each(["s3", "r2", "minio"] as const)("%s 缺少远端配置时不回退 local", async (driver) => {
    stubRemoteStorage(driver);
    vi.stubEnv("S3_BUCKET", "");

    await expect(getStorage()).rejects.toThrow("S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY");
    expect(getStorageKind()).toBe("local");
  });

  it("S3Driver 构造失败时不回退 local", async () => {
    vi.resetModules();
    vi.doMock("./s3", () => ({
      S3Driver: class {
        constructor() {
          throw new Error("synthetic S3 constructor failure");
        }
      },
    }));
    stubRemoteStorage("s3");
    const isolatedFactory = await import("./index");

    await expect(isolatedFactory.getStorage()).rejects.toThrow("synthetic S3 constructor failure");
    expect(isolatedFactory.getStorageKind()).toBe("local");
    isolatedFactory.__resetStorageForTest();
  });
});
