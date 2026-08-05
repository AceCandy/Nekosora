import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 密钥加密 —— 所有存入数据库的上游 provider api key、用户 BYO key 都用
 * AES-256-GCM 加密后入库(借鉴 DEEIX-Chat 的 secretbox 设计)。
 *
 * 主密钥来自环境变量 DATA_ENCRYPTION_KEY(32 字节十六进制)。
 * 每条密文自带 12 字节随机 IV + 16 字节 GCM auth tag,以 base64 包装:
 *   base64(iv(12) || ciphertext || tag(16))
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const WEAK_KEYS = new Set([
  "0".repeat(64),
  "f".repeat(64),
]);

let cachedKey: Buffer | null = null;

/** 从环境读取并校验主密钥(32 字节 hex)。弱密钥会在非 dev 环境抛错。 */
function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "DATA_ENCRYPTION_KEY 未配置。请生成 32 字节十六进制密钥:openssl rand -hex 32",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("DATA_ENCRYPTION_KEY 必须是 64 位十六进制字符(32 字节)。");
  }

  const key = Buffer.from(raw, "hex");
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev && WEAK_KEYS.has(raw.toLowerCase())) {
    throw new Error("生产环境禁止使用弱/默认 DATA_ENCRYPTION_KEY。");
  }

  cachedKey = key;
  return key;
}

/** 加密明文,返回 base64 字符串。 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // tag 置于末尾,GCM 解密时需先切下。
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/** 解密 encrypt() 产出的密文,返回明文。认证失败会抛错。 */
export function decrypt(payload: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("密文长度不足,无法解密。");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * 对称字符串哈希(用于本地查找,非密钥用途)。返回 64 位十六进制。
 * 用于 api key 的 key_hash 存储 —— 校验时遍历候选或按 prefix 取回后比较。
 */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 常量时间比较,避免时序侧信道。 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
