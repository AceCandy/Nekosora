/**
 * 输出方式服务 —— 管理员预设的会话级输出模式(如「HTML 渲染」「简洁输出」)。
 *
 * 每个方式含一段 systemPrompt,选定后注入会话,引导模型按特定格式/风格回答。
 * 全局配置(管理员域),所有用户共享;用户在 chat 工具栏选用,写入 conversations.outputModeId。
 */
import { eq, asc } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession, requireAdmin } from "@/lib/session";

export interface OutputMode {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  icon: string | null;
  enabled: boolean;
  sortOrder: number;
}

/** 管理员:列出全部输出方式(含禁用)。 */
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

/** 用户:列出启用的输出方式(供 chat 工具栏选择)。 */
export async function listEnabledOutputModes(): Promise<OutputMode[]> {
  await requireSession();
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
}

/** 读取单个输出方式(用于 chat route 注入)。不鉴权(内部调用,route 已鉴权)。 */
export async function getOutputMode(id: string): Promise<OutputMode | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [row] = await db.select().from(s.outputModes).where(eq(s.outputModes.id, id)).limit(1);
  return (row as OutputMode | undefined) ?? null;
}

/** 管理员:创建输出方式。 */
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
  const [row] = await db
    .insert(s.outputModes)
    .values({
      name: input.name,
      description: input.description ?? null,
      systemPrompt: input.systemPrompt,
      icon: input.icon ?? null,
    })
    .returning();
  return row as OutputMode;
}

/** 管理员:更新输出方式。 */
export async function updateOutputMode(
  id: string,
  patch: Partial<Pick<OutputMode, "name" | "description" | "systemPrompt" | "icon" | "enabled" | "sortOrder">>,
): Promise<void> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.update(s.outputModes).set({ ...patch, updatedAt: new Date() }).where(eq(s.outputModes.id, id));
}

/** 管理员:删除输出方式。 */
export async function deleteOutputMode(id: string): Promise<void> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.delete(s.outputModes).where(eq(s.outputModes.id, id));
}
