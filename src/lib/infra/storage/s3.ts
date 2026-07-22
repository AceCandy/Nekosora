/**
 * S3Driver —— 基于 AWS S3 协议,一个实现覆盖 S3 / R2 / MinIO。
 *
 * R2 和 MinIO 是 S3 兼容协议,只需改 endpoint,故复用同一类:
 *   - AWS S3:   endpoint 留空,region 必填
 *   - R2:       endpoint=https://<account>.r2.cloudflaretunnel.com, region="auto"
 *   - MinIO:    endpoint=http://minio:9000, region 任意(常用 "us-east-1")
 *
 * AWS SDK v3 用动态 import(对标 queue.ts 对 pg-boss 的处理),阻断 Turbopack
 * 把它拉入 Edge instrumentation bundle(aws-sdk 体积大,且依赖 node 内置模块)。
 *
 * 公网直链:配了 S3_PUBLIC_BASE_URL(CDN/公开 bucket 前缀)时 publicReadable=true,
 * put 返回的 url 即 `${PUBLIC_BASE}/${key}`,vision 调用可直接传该 URL。
 * 否则 publicReadable=false,下载走 signedUrl(预签名,默认 7 天上限)。
 */
import type { S3Client } from "@aws-sdk/client-s3";
import type {
  PutObjectCommandInput,
  GetObjectCommandInput,
  DeleteObjectCommandInput,
} from "@aws-sdk/client-s3";
import type { StorageDriver, StorageKind, StorageResult, PutOpts, GetOpts } from "./driver";

/** S3 兼容 driver 的构造配置(从环境变量读取)。 */
export interface S3DriverOptions {
  kind: Extract<StorageKind, "s3" | "r2" | "minio">;
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 公网直链前缀(配 CDN 或公开 bucket);空=走 signedUrl。 */
  publicBaseUrl?: string;
  /** forcePathStyle:MinIO / 自部署 S3 通常需要(true);R2/AWS 用 false。 */
  forcePathStyle?: boolean;
}

export class S3Driver implements StorageDriver {
  readonly kind: StorageKind;
  readonly publicReadable: boolean;

  private readonly bucket: string;
  private readonly publicBaseUrl: string | null;
  private clientPromise: Promise<S3Client> | null = null;
  private readonly opts: S3DriverOptions;

  constructor(opts: S3DriverOptions) {
    this.opts = opts;
    this.kind = opts.kind;
    this.bucket = opts.bucket;
    this.publicBaseUrl = opts.publicBaseUrl || null;
    this.publicReadable = !!this.publicBaseUrl;
  }

  /** 惰性初始化 S3Client(动态 import,避免 Edge bundle 拉入 aws-sdk)。 */
  private async client(): Promise<S3Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client: Client } = await import("@aws-sdk/client-s3");
        return new Client({
          endpoint: this.opts.endpoint || undefined,
          region: this.opts.region,
          credentials: {
            accessKeyId: this.opts.accessKeyId,
            secretAccessKey: this.opts.secretAccessKey,
          },
          forcePathStyle: this.opts.forcePathStyle ?? false,
        });
      })();
    }
    return this.clientPromise;
  }

  async put(key: string, data: Buffer, mime: string, opts?: PutOpts): Promise<StorageResult> {
    const client = await this.client();
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const input: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: opts?.contentType ?? mime,
    };
    await client.send(new PutObjectCommand(input));
    const url = this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : null;
    return { key, url, size: data.byteLength };
  }

  async get(key: string, opts?: GetOpts): Promise<Buffer> {
    const client = await this.client();
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const input: GetObjectCommandInput = {
      Bucket: this.bucket,
      Key: key,
      ...(opts ? { Range: `bytes=${opts.start}-${opts.end}` } : {}),
    };
    const resp = await client.send(new GetObjectCommand(input));
    const body = resp.Body;
    if (!body) throw new Error(`S3 object 无 body: ${key}`);
    // SDK v3 的 Body 是 StreamingBlobPayloadOutputTypes,转 Buffer。
    const bytes = await (body as { transformToByteArray?: () => Promise<Uint8Array> })
      .transformToByteArray?.();
    if (!bytes) throw new Error(`S3 object body 转换失败: ${key}`);
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    const client = await this.client();
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const input: DeleteObjectCommandInput = { Bucket: this.bucket, Key: key };
    await client.send(new DeleteObjectCommand(input));
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string | null> {
    // 已配公网直链则无需签名。
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${key}`;
    const client = await this.client();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    // S3 预签名上限 7 天(604800 秒),超出由调用方负责。
    const ttl = Math.min(Math.max(ttlSeconds, 1), 604800);
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttl,
    });
  }
}
