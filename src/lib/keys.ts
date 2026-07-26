/**
 * 密钥管理 —— 主 Key(每用户唯一,可调用)与子 Key(多个,受模型绑定约束)。
 *
 * 存储:只存 sha256 hash + 显示用 prefix,明文仅创建时一次性返回。
 * 格式:${SK_PREFIX}${nanoid(SK_RANDOM_LENGTH)},如 sk-abc123...
 *
 * 校验:从 Authorization: Bearer 提取 → sha256 → 按 prefix 候选查回 → 常量时间比对。
 */
import { customAlphabet } from "nanoid";
import { and, eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { hashSecret, safeEqual, encrypt } from "@/lib/infra/crypto";
import { getEnvInfo } from "@/lib/infra/env";
import type { CallContext } from "@/lib/providers/types";

// 排除易混字符的字母表。
const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const generateSecret = customAlphabet(alphabet, 48);

export interface ApiKeyRecord {
  id: string;
  userId: string;
  parentId: string | null;
  kind: "master" | "sub";
  name: string;
  keyHash: string;
  keyPrefix: string;
  enabled: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** 生成一个新的明文 key 字符串。 */
function generateRawKey(): string {
  const { skPrefix } = getEnvInfo();
  return `${skPrefix}${generateSecret()}`;
}

/** 从明文 key 提取显示用 prefix(前 8 字符 + …)。 */
function makePrefix(rawKey: string): string {
  return rawKey.slice(0, 8) + "…";
}

/** 创建主 Key(每用户唯一)。如已存在则抛错。返回明文(仅此一次)。 */
export async function createMasterKey(userId: string, name = "主密钥"): Promise<string> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 幂等检查:已有主 key 则抛错。
  const existing = await db
    .select()
    .from(s.apiKeys)
    .where(eq(s.apiKeys.userId, userId));
  const hasMaster = existing.some((k: ApiKeyRecord) => k.kind === "master");
  if (hasMaster) throw new Error("该用户已存在主密钥");

  const rawKey = generateRawKey();
  await db.insert(s.apiKeys).values({
    userId,
    parentId: null,
    kind: "master",
    name,
    keyHash: hashSecret(rawKey),
    keyPrefix: makePrefix(rawKey),
    enabled: true,
  });
  return rawKey;
}

/** 创建子 Key。返回明文(仅此一次)。 */
export async function createSubKey(
  userId: string,
  name: string,
): Promise<string> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 找到该用户的主 key 作为 parent。
  const keys = await db
    .select()
    .from(s.apiKeys)
    .where(eq(s.apiKeys.userId, userId));
  const master = keys.find((k: ApiKeyRecord) => k.kind === "master");
  if (!master) throw new Error("用户尚无主密钥,无法创建子密钥");

  const rawKey = generateRawKey();
  await db.insert(s.apiKeys).values({
    userId,
    parentId: master.id,
    kind: "sub",
    name,
    keyHash: hashSecret(rawKey),
    keyPrefix: makePrefix(rawKey),
    enabled: true,
  });
  return rawKey;
}

/** 列出用户所有密钥(不含明文 hash,仅展示用)。 */
export async function listKeys(userId: string): Promise<ApiKeyRecord[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  return db.select().from(s.apiKeys).where(eq(s.apiKeys.userId, userId));
}

/** 禁用/启用密钥。 */
export async function setKeyEnabled(userId: string, keyId: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db
    .update(s.apiKeys)
    .set({ enabled })
    .where(and(eq(s.apiKeys.id, keyId), eq(s.apiKeys.userId, userId)));
}

/**
 * 校验原始 key 字符串,返回调用上下文。失败返回 null。
 *
 * 策略:sha256(raw) → 查询 active 用户的 enabled key 候选 → 常量时间比对 → 更新 lastUsedAt。
 * 用 prefix 先缩小候选集(prefix 索引)。
 */
export async function verifyKey(rawKey: string): Promise<{
  ctx: CallContext;
  record: ApiKeyRecord;
} | null> {
  if (!rawKey) return null;
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const keyHash = hashSecret(rawKey);
  const prefix = makePrefix(rawKey);

  // 按 prefix 缩小候选范围,并在同一次读取中约束 key 与所属用户均可用。
  const candidates = await db
    .select({ key: s.apiKeys })
    .from(s.apiKeys)
    .innerJoin(s.user, eq(s.apiKeys.userId, s.user.id))
    .where(
      and(
        eq(s.apiKeys.keyPrefix, prefix),
        eq(s.apiKeys.enabled, true),
        eq(s.user.status, "active"),
      ),
    );

  for (const { key: row } of candidates as { key: ApiKeyRecord }[]) {
    if (safeEqual(row.keyHash, keyHash)) {
      // 更新最后使用时间(失败不阻断)。
      try {
        await db
          .update(s.apiKeys)
          .set({ lastUsedAt: new Date() })
          .from(s.user)
          .where(
            and(
              eq(s.apiKeys.id, row.id),
              eq(s.apiKeys.enabled, true),
              eq(s.apiKeys.userId, s.user.id),
              eq(s.user.status, "active"),
            ),
          );
      } catch {
        /* ignore */
      }
      return {
        record: row,
        ctx: {
          userId: row.userId,
          apiKeyId: row.id,
          keyKind: row.kind,
          source: "gateway",
        },
      };
    }
  }
  return null;
}

/** 从 Authorization 头提取 bearer token。 */
export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : null;
}

// re-export encrypt 供 BYO provider key 加密(后台用)
export { encrypt };
