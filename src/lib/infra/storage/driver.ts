/**
 * 对象存储统一接口 —— 抽象本地磁盘 / S3 / R2 / MinIO 等后端。
 *
 * 设计对标项目其他降级基建(db / cache / queue):
 *   - 业务代码统一 import { getStorage } from "@/lib/infra/storage";
 *   - 具体后端由 STORAGE_DRIVER 环境变量选择,默认 LocalDriver(零配置兜底)。
 *
 * key 约定:driver 无关的相对路径,如 "userId/fileId-name.png"。
 * 各 driver 自行解释(本地拼成绝对路径,S3 作为 object key)。
 */

/** driver 类型字面量(供 env 选择与展示)。 */
export type StorageKind = "local" | "s3" | "r2" | "minio";

/** put 的可选参数。 */
export interface PutOpts {
  /** 覆盖 MIME;默认用调用方传入的 mime。 */
  contentType?: string;
}

/** put 的返回结果。 */
export interface StorageResult {
  /** 实际存储的 key(一般与入参一致)。 */
  key: string;
  /** 公网可访问 URL;null 表示无直链,需走鉴权代理(/api/files/[fileId])。 */
  url: string | null;
  /** 字节数。 */
  size: number;
}

/**
 * 存储后端契约 —— 所有 driver 实现。
 *
 * put/get/delete 必须可重试、幂等(重复 put 同 key 覆盖)。
 */
export interface StorageDriver {
  readonly kind: StorageKind;

  /** 上传。返回可访问 URL(无则 null,需走鉴权代理)。 */
  put(key: string, data: Buffer, mime: string, opts?: PutOpts): Promise<StorageResult>;

  /** 读取为 Buffer。key 不存在应抛错(ENOENT / NoSuchKey)。 */
  get(key: string): Promise<Buffer>;

  /** 删除。key 不存在不视为错误。 */
  delete(key: string): Promise<void>;

  /**
   * 生成预签名下载 URL(私有 bucket 临时访问)。
   * Local driver 无此能力,返回 null。
   */
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;

  /**
   * 是否支持公网直链(决定 P1-C vision 调用走 url 还是 base64 内联)。
   * S3 配了 CDN/S3_PUBLIC_BASE_URL 时为 true;否则 false。
   */
  readonly publicReadable: boolean;
}
