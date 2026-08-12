/**
 * 密钥管理 —— 主 Key(每用户唯一,可调用)与子 Key(多个,受模型绑定约束)。
 *
 * 存储:只存 sha256 hash + 脱敏预览,明文仅创建时一次性返回。
 * 格式:${SK_PREFIX}${nanoid(SK_RANDOM_LENGTH)},如 sk-abc123...
 *
 * 校验:从 Authorization: Bearer 提取 → sha256 → 按 prefix 候选查回 → 常量时间比对。
 */
import { customAlphabet } from "nanoid";
import { and, eq, or } from "drizzle-orm";
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
  kind: "master" | "sub";
  name: string;
  keyHash: string;
  keyPrefix: string;
  enabled: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** 密钥管理页面可见的最小字段集合。 */
export interface ApiKeyListItem {
  id: string;
  name: string;
  keyPrefix: string;
  kind: "master" | "sub";
  enabled: boolean;
}

/** 生成一个新的明文 key 字符串。 */
function generateRawKey(): string {
  const { skPrefix } = getEnvInfo();
  return `${skPrefix}${generateSecret()}`;
}

/** 旧记录使用的查询前缀。 */
function makeLegacyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8) + "…";
}

/** 从明文 key 生成前后可辨识的脱敏预览。 */
function makeKeyPreview(rawKey: string): string {
  return `${rawKey.slice(0, 8)}****${rawKey.slice(-4)}`;
}

/** 创建主 Key；已有已撤销记录时原位轮换。返回明文(仅此一次)。 */
export async function createMasterKey(userId: string, name = "主密钥"): Promise<string> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 每个用户只保留一条主 key 记录，撤销后原位轮换。
  const existing = await db
    .select()
    .from(s.apiKeys)
    .where(eq(s.apiKeys.userId, userId));
  const master = existing.find((k: ApiKeyRecord) => k.kind === "master");
  if (master?.enabled) throw new Error("该用户已存在主密钥");

  const rawKey = generateRawKey();
  if (master) {
    const updated = await db
      .update(s.apiKeys)
      .set({
        keyHash: hashSecret(rawKey),
        keyPrefix: makeKeyPreview(rawKey),
        enabled: true,
        lastUsedAt: null,
      })
      .where(and(
        eq(s.apiKeys.id, master.id),
        eq(s.apiKeys.userId, userId),
        eq(s.apiKeys.kind, "master"),
        eq(s.apiKeys.enabled, false),
      ))
      .returning({ id: s.apiKeys.id });
    if (updated.length !== 1) throw new Error("该用户已存在主密钥");
    return rawKey;
  }

  await db.insert(s.apiKeys).values({
    userId,
    kind: "master",
    name,
    keyHash: hashSecret(rawKey),
    keyPrefix: makeKeyPreview(rawKey),
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

  // 子 key 仅在该用户有可用主 key 时创建。
  const keys = await db
    .select()
    .from(s.apiKeys)
    .where(eq(s.apiKeys.userId, userId));
  const hasEnabledMaster = keys.some((k: ApiKeyRecord) => k.kind === "master" && k.enabled);
  if (!hasEnabledMaster) throw new Error("用户尚无主密钥,无法创建子密钥");

  const rawKey = generateRawKey();
  await db.insert(s.apiKeys).values({
    userId,
    kind: "sub",
    name,
    keyHash: hashSecret(rawKey),
    keyPrefix: makeKeyPreview(rawKey),
    enabled: true,
  });
  return rawKey;
}

/** 列出用户所有密钥，仅查询页面需要的脱敏字段。 */
export async function listKeys(userId: string): Promise<ApiKeyListItem[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  return db
    .select({
      id: s.apiKeys.id,
      name: s.apiKeys.name,
      keyPrefix: s.apiKeys.keyPrefix,
      kind: s.apiKeys.kind,
      enabled: s.apiKeys.enabled,
    })
    .from(s.apiKeys)
    .where(eq(s.apiKeys.userId, userId));
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
  const legacyPrefix = makeLegacyPrefix(rawKey);
  const keyPreview = makeKeyPreview(rawKey);

  // 按 prefix 缩小候选范围,并在同一次读取中约束 key 与所属用户均可用。
  const candidates = await db
    .select({ key: s.apiKeys })
    .from(s.apiKeys)
    .innerJoin(s.user, eq(s.apiKeys.userId, s.user.id))
    .where(
      and(
        or(
          eq(s.apiKeys.keyPrefix, legacyPrefix),
          eq(s.apiKeys.keyPrefix, keyPreview),
        ),
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
