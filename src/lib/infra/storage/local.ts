/**
 * LocalDriver —— 本地磁盘存储,零配置兜底。
 *
 * 与项目"零依赖本地开发"原则一致:不配 S3 时永远可用。
 * 默认根目录 LOCAL_STORAGE_DIR(默认 ./uploads),与历史代码
 * join(process.cwd(), "uploads", ...) 拼出的路径完全一致 —— 现有数据零迁移。
 *
 * 向后兼容:旧 file_objects.storagePath 存的是绝对路径(如 /app/uploads/...)。
 * get/put/delete 内部做一次 isAbsoluteKey 判断:绝对路径直接用,否则拼 root。
 */
import { open, readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { dirname, join, resolve, isAbsolute } from "node:path";
import type { StorageDriver, StorageKind, StorageResult, PutOpts, GetOpts } from "./driver";

/** LocalDriver 构造参数。 */
export interface LocalDriverOptions {
  /** 本地根目录(绝对或相对;相对路径基于 process.cwd())。 */
  rootDir: string;
}

export class LocalDriver implements StorageDriver {
  readonly kind: StorageKind = "local";
  /** 本地无公网直链(P1-C vision 走 base64 内联)。 */
  readonly publicReadable = false;

  private readonly root: string;

  constructor(opts: LocalDriverOptions) {
    // 相对路径基于 cwd 解析(与现状 join(process.cwd(), "uploads") 一致)。
    this.root = isAbsolute(opts.rootDir) ? opts.rootDir : resolve(process.cwd(), opts.rootDir);
  }

  private resolveKey(key: string): string {
    // 向后兼容:旧记录是绝对路径,直接用;否则拼到 root 下。
    if (isAbsolute(key)) return key;
    return join(this.root, key);
  }

  async put(key: string, data: Buffer, _mime: string, _opts?: PutOpts): Promise<StorageResult> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { key, url: null, size: data.byteLength };
  }

  async get(key: string, opts?: GetOpts): Promise<Buffer> {
    const path = this.resolveKey(key);
    if (!opts) return readFile(path);

    const length = opts.end - opts.start + 1;
    if (
      !Number.isSafeInteger(opts.start) ||
      !Number.isSafeInteger(opts.end) ||
      opts.start < 0 ||
      length <= 0
    ) {
      throw new RangeError("无效的存储读取范围");
    }

    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, opts.start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.resolveKey(key);
    try {
      await unlink(path);
    } catch (err) {
      // key 不存在不视为错误(与 S3 语义对齐)。
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async signedUrl(_key: string, _ttlSeconds: number): Promise<string | null> {
    return null;
  }

  /** 测试/诊断用:判断 key 是否已存在。 */
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}
