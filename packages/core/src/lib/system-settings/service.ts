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
