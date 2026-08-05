/**
 * 系统设置 service —— system_settings 表的读写(upsert 语义)。
 *
 * 供 admin 配置页使用:embedding / web_search 等功能读这里写入的配置。
 * 写入后调用方应清除对应 registry 的内存缓存以即时生效。
 */
import { and, eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";

/** 读取某个 namespace 下全部键值对。 */
export async function getSettings(namespace: string): Promise<Record<string, string>> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = await db
    .select({ key: s.systemSettings.key, value: s.systemSettings.value })
    .from(s.systemSettings)
    .where(eq(s.systemSettings.namespace, namespace));
  const map: Record<string, string> = {};
  for (const r of rows) map[String(r.key)] = String(r.value);
  return map;
}

/** 读取单个值。 */
export async function getSetting(namespace: string, key: string): Promise<string | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [row] = await db
    .select({ value: s.systemSettings.value })
    .from(s.systemSettings)
    .where(and(eq(s.systemSettings.namespace, namespace), eq(s.systemSettings.key, key)))
    .limit(1);
  return row ? String(row.value) : null;
}

/**
 * 批量 upsert 某 namespace 下的键值对(存在则更新,不存在则插入)。
 * 空字符串视为删除该键(便于「清空配置」)。
 */
export async function upsertSettings(namespace: string, values: Record<string, string>): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  for (const [key, value] of Object.entries(values)) {
    const existing = await db
      .select({ id: s.systemSettings.id })
      .from(s.systemSettings)
      .where(and(eq(s.systemSettings.namespace, namespace), eq(s.systemSettings.key, key)))
      .limit(1);
    if (value === "") {
      // 空值:若已存在则删除(允许取消配置)
      if (existing.length > 0) {
        await db.delete(s.systemSettings).where(eq(s.systemSettings.id, existing[0].id));
      }
      continue;
    }
    if (existing.length > 0) {
      await db
        .update(s.systemSettings)
        .set({ value, updatedAt: new Date() })
        .where(eq(s.systemSettings.id, existing[0].id));
    } else {
      await db.insert(s.systemSettings).values({ namespace, key, value });
    }
  }
}
