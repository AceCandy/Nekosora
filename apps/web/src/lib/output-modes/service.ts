/**
 * 输出模式服务 —— 管理员预设的会话级输出模式(如「HTML 渲染」「简洁输出」)。
 *
 * 每个方式含一段 systemPrompt,选定后注入会话,引导模型按特定格式/风格回答。
 * 全局配置(管理员域),所有用户共享;用户在 chat 工具栏选用,写入 conversations.outputModeId。
 */
import { eq, asc, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { cacheWrap, cacheDel } from "@/lib/infra/cache";
import { requireSession, requireAdmin } from "@/lib/session";
import type { OutputMode } from "@/lib/output-modes/read";

export { getOutputMode, type OutputMode } from "@/lib/output-modes/read";

/** chat 工具栏读取的启用输出模式缓存键(全局共享;admin 写操作主动失效,TTL 兜底)。 */
const ENABLED_OUTPUT_MODES_KEY = "chat:output-modes:enabled";

/** 管理员:列出全部输出模式(含禁用)。 */
export async function listAllOutputModes(): Promise<OutputMode[]> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = await db
    .select()
    .from(s.outputModes)
    .orderBy(asc(s.outputModes.sortOrder), asc(s.outputModes.createdAt));
  return rows as OutputMode[];
}

/** 用户:列出启用的输出模式(供 chat 工具栏选择)。全局共享,带缓存。 */
export async function listEnabledOutputModes(): Promise<OutputMode[]> {
  await requireSession();
  return cacheWrap(ENABLED_OUTPUT_MODES_KEY, async () => {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const rows = await db
      .select({
        id: s.outputModes.id,
        name: s.outputModes.name,
        description: s.outputModes.description,
        systemPrompt: s.outputModes.systemPrompt,
        icon: s.outputModes.icon,
        enabled: s.outputModes.enabled,
        sortOrder: s.outputModes.sortOrder,
      })
      .from(s.outputModes)
      .where(eq(s.outputModes.enabled, true))
      .orderBy(asc(s.outputModes.sortOrder), asc(s.outputModes.createdAt));
    return rows as OutputMode[];
  });
}

/** 管理员:创建输出模式。新建项默认放末尾(sortOrder = 当前 max + 1)。 */
export async function createOutputMode(input: {
  name: string;
  description?: string;
  systemPrompt: string;
  icon?: string;
}): Promise<OutputMode> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // 查当前最大 sortOrder,新项排在末尾(空表时从 0 起)。
  const [maxRow] = await db
    .select({ maxSort: sql<number>`coalesce(max(${s.outputModes.sortOrder}), -1)` })
    .from(s.outputModes);
  const nextSort = (maxRow?.maxSort ?? -1) + 1;
  const [row] = await db
    .insert(s.outputModes)
    .values({
      name: input.name,
      description: input.description ?? null,
      systemPrompt: input.systemPrompt,
      icon: input.icon ?? null,
      sortOrder: nextSort,
    })
    .returning();
  await cacheDel(ENABLED_OUTPUT_MODES_KEY).catch(() => {});
  return row as OutputMode;
}

/**
 * 管理员:按拖动后的 id 顺序全表重写 sortOrder 为连续整数 0,1,2…
 * 单事务包裹,中途失败整体回滚(避免半成品状态)。id 不存在自然跳过(update 0 行),不抛错。
 */
export async function reorderOutputModes(orderedIds: string[]): Promise<void> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(s.outputModes).set({ sortOrder: i }).where(eq(s.outputModes.id, orderedIds[i]));
    }
  });
  await cacheDel(ENABLED_OUTPUT_MODES_KEY).catch(() => {});
}

/** 管理员:更新输出模式。 */
export async function updateOutputMode(
  id: string,
  patch: Partial<Pick<OutputMode, "name" | "description" | "systemPrompt" | "icon" | "enabled" | "sortOrder">>,
): Promise<void> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.update(s.outputModes).set({ ...patch, updatedAt: new Date() }).where(eq(s.outputModes.id, id));
  await cacheDel(ENABLED_OUTPUT_MODES_KEY).catch(() => {});
}

/** 管理员:删除输出模式。 */
export async function deleteOutputMode(id: string): Promise<void> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.delete(s.outputModes).where(eq(s.outputModes.id, id));
  await cacheDel(ENABLED_OUTPUT_MODES_KEY).catch(() => {});
}
