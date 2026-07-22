/**
 * 存储降级工厂 —— 按 STORAGE_DRIVER 环境变量选后端,惰性初始化单例。
 *
 * 选择逻辑(对标 db/index.ts 的 resolveDialect):
 *   1. STORAGE_DRIVER=s3/r2/minio + S3_BUCKET 配置 → S3Driver(动态 import aws-sdk)
 *   2. 默认 → LocalDriver(零配置,写 ./uploads)
 *   3. S3 初始化失败(配置缺失/非法) → 自动 fallback LocalDriver + console.warn
 *
 * 业务代码统一 import { getStorage } from "@/lib/infra/storage";
 * 永远不直接 import 具体 driver 模块。
 */
import type { StorageDriver, StorageKind } from "./driver";
import { LocalDriver } from "./local";

export type { StorageDriver, StorageKind, StorageResult, PutOpts, GetOpts } from "./driver";

/** S3 协议 driver 类型子集(local 不是 S3 协议)。 */
export type S3LikeKind = "s3" | "r2" | "minio";

/** 解析 STORAGE_DRIVER 配置(纯函数,便于测试)。返回 null 表示走 local。 */
export function resolveStorageKind(): S3LikeKind | null {
  const raw = (process.env.STORAGE_DRIVER ?? "").toLowerCase().trim();
  if (raw === "s3" || raw === "r2" || raw === "minio") return raw;
  return null;
}

let _storage: StorageDriver | null = null;
let _resolvedKind: StorageKind = "local";

/** 构造 S3 driver(若配置不全则抛错,由 getStorage 捕获并 fallback)。 */
async function buildS3Driver(kind: S3LikeKind): Promise<StorageDriver> {
  const { S3Driver } = await import("./s3");
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      `STORAGE_DRIVER=${kind} 但缺少 S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY 之一`,
    );
  }
  // R2 / MinIO 强制 path-style(避免 DNS 解析问题);AWS S3 用默认。
  const forcePathStyle = kind !== "s3" || !!process.env.S3_ENDPOINT;
  return new S3Driver({
    kind,
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION ?? (kind === "r2" ? "auto" : "us-east-1"),
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || undefined,
    forcePathStyle,
  });
}

/** 构造 Local driver。 */
function buildLocalDriver(): LocalDriver {
  return new LocalDriver({
    rootDir: process.env.LOCAL_STORAGE_DIR ?? "./uploads",
  });
}

/** 构造存储 driver 单例(带降级)。 */
async function buildStorage(): Promise<StorageDriver> {
  const kind = resolveStorageKind();
  if (kind) {
    try {
      const driver = await buildS3Driver(kind);
      _resolvedKind = kind;
      console.log(`[storage] 已启用 ${kind} driver (bucket=${process.env.S3_BUCKET})`);
      return driver;
    } catch (err) {
      console.warn(
        `[storage] ${kind} driver 初始化失败,回退到 local:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  _resolvedKind = "local";
  return buildLocalDriver();
}

/** 获取存储 driver 单例(惰性)。 */
export async function getStorage(): Promise<StorageDriver> {
  if (!_storage) _storage = await buildStorage();
  return _storage;
}

/** 当前已解析的 driver 类型(必须先调用过 getStorage)。 */
export function getStorageKind(): StorageKind {
  return _resolvedKind;
}

/** 测试用:重置单例(切换配置后)。 */
export function __resetStorageForTest(): void {
  _storage = null;
  _resolvedKind = "local";
}
