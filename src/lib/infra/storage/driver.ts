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
  /** 明确公共产物的公网 URL;null 表示未配置公共产物 URL。 */
  url: string | null;
  /** 字节数。 */
  size: number;
}

/** get 的可选字节闭区间。 */
export interface GetOpts {
  start: number;
  end: number;
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

  /** 读取为 Buffer；opts 缺省时读取完整对象。key 不存在应抛错(ENOENT / NoSuchKey)。 */
  get(key: string, opts?: GetOpts): Promise<Buffer>;

  /** 删除。key 不存在不视为错误。 */
  delete(key: string): Promise<void>;

  /**
   * 生成临时预签名下载 URL，不受公共产物 URL 配置影响。
   * Local driver 无此能力,返回 null。
   */
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;

  /**
   * 是否配置公共产物 URL 能力，决定 P1-C vision 使用临时 URL 还是 base64。
   * 此值不表示私有文件可绕过鉴权直接读取。
   */
  readonly publicReadable: boolean;
}
