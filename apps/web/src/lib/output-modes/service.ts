/**
 * 输出模式服务 —— 管理员预设的会话级输出模式(如「HTML 渲染」「简洁输出」)。
 *
 * 每个方式含一段 systemPrompt,选定后注入会话,引导模型按特定格式/风格回答。
 * 全局配置(管理员域),所有用户共享;用户在 chat 工具栏选用,写入 conversations.outputModeId。
 */
import { eq, asc } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { cacheWrap, cacheDel } from "@/lib/infra/cache";
import { requireSession, requireAdmin } from "@/lib/session";
import type { OutputMode } from "@/lib/output-modes/read";
import { getSettingsRevision } from "@/lib/settings-control/service";

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
  const revision = await getSettingsRevision();
  return cacheWrap(`${ENABLED_OUTPUT_MODES_KEY}:${revision}`, async () => {
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

export async function invalidateOutputModesCache(revision: number): Promise<void> {
  await cacheDel(`${ENABLED_OUTPUT_MODES_KEY}:${revision}`);
}
