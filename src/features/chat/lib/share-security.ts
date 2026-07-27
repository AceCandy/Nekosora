import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_VERSION = "v1";
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const TOKEN_VERSION = 1;
const UNLOCK_TTL_MS = 24 * 60 * 60 * 1000;

function scrypt(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

function getSigningKey(purpose: string): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET 未配置");
  return createHmac("sha256", secret).update(`nekusora:conversation-share:${purpose}:v1`).digest();
}

function sign(payload: string, purpose: string): string {
  return createHmac("sha256", getSigningKey(purpose)).update(payload).digest("base64url");
}

function equalEncoded(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 为用户输入的分享密码生成版本化 scrypt verifier。 */
export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt, SCRYPT_KEY_LENGTH);
  return [
    "scrypt",
    SCRYPT_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join("$");
}

/** 校验分享密码；畸形或未知版本 verifier 一律返回 false。 */
export async function verifySharePassword(password: string, verifier: string): Promise<boolean> {
  const [algorithm, version, n, r, p, saltValue, digestValue, extra] = verifier.split("$");
  if (
    extra !== undefined ||
    algorithm !== "scrypt" ||
    version !== SCRYPT_VERSION ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    !saltValue ||
    !digestValue
  ) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(digestValue, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await scrypt(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

interface UnlockTokenPayload {
  v: number;
  shareId: string;
  exp: number;
  nonce: string;
}

/** 创建只绑定单个分享的 24 小时解锁票据，并夹到链接有效期。 */
export function createShareUnlockToken(
  shareId: string,
  shareExpiresAt: Date | null,
  now = new Date(),
): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Math.min(
    now.getTime() + UNLOCK_TTL_MS,
    shareExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
  ));
  const payload: UnlockTokenPayload = {
    v: TOKEN_VERSION,
    shareId,
    exp: expiresAt.getTime(),
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${encoded}.${sign(encoded, "unlock")}`, expiresAt };
}

/** 校验票据签名、分享绑定与到期时间。 */
export function verifyShareUnlockToken(token: string | undefined, shareId: string, now = new Date()): boolean {
  if (!token) return false;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined) return false;
  if (!equalEncoded(signature, sign(encoded, "unlock"))) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<UnlockTokenPayload>;
    return payload.v === TOKEN_VERSION &&
      payload.shareId === shareId &&
      typeof payload.exp === "number" &&
      Number.isSafeInteger(payload.exp) &&
      payload.exp > now.getTime() &&
      typeof payload.nonce === "string" &&
      payload.nonce.length > 0;
  } catch {
    return false;
  }
}

/** 分享专属 HttpOnly Cookie 名；shareId 只接受服务端已查询到的 UUID。 */
export function getShareUnlockCookieName(shareId: string): string {
  return `nekusora_share_unlock_${shareId}`;
}

/** 对客户端来源做不可逆、域分离指纹；调用方不得传入或落库原始 IP。 */
export function fingerprintShareClient(source: string): string {
  return createHmac("sha256", getSigningKey("client-fingerprint"))
    .update(source || "unknown")
    .digest("hex");
}
