import { and, eq } from "drizzle-orm";
import { getSchema } from "@/lib/infra/db";

/** 获取指定属主拥有的服务商，不向调用方泄露其他服务商是否存在。 */
export async function requireOwnedProvider(
  db: unknown,
  providerId: string,
  ownerUserId: string,
): Promise<{ id: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [provider] = await (db as any)
    .select({ id: s.providers.id })
    .from(s.providers)
    .where(and(eq(s.providers.id, providerId), eq(s.providers.ownerUserId, ownerUserId)))
    .limit(1);
  if (!provider) throw new Error("服务商不存在");
  return provider as { id: string };
}
