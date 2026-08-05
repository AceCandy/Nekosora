/**
 * 输出样式服务 —— 管理员预设的会话级 Markdown 渲染样式。
 *
 * 每个样式含一段 css 与一个稳定 cssClass,选定后给 AI 回答正文容器套上
 * rs-{cssClass} 类,CSS 经聊天页聚合注入后作用于渲染。纯渲染层,不影响模型输出。
 * 全局配置(管理员域),所有用户共享;用户在 chat 工具栏选用,写入 conversations.renderStyleId。
 */
import { eq, asc, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { cacheWrap, cacheDel } from "@/lib/infra/cache";
import { requireSession, requireAdmin } from "@/lib/session";

/** chat 工具栏读取的启用输出样式缓存键(全局共享;admin 写操作主动失效,TTL 兜底)。 */
const ENABLED_RENDER_STYLES_KEY = "chat:render-styles:enabled";

export interface RenderStyle {
  id: string;
  name: string;
  description: string | null;
  cssClass: string;
  css: string;
  icon: string | null;
  renderer: "streamdown" | "custom";
  builtin: boolean;
  enabled: boolean;
  sortOrder: number;
}

/** 管理员:列出全部输出样式(含禁用)。 */
export async function listAllRenderStyles(): Promise<RenderStyle[]> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = await db
    .select()
    .from(s.renderStyles)
    .orderBy(asc(s.renderStyles.sortOrder), asc(s.renderStyles.createdAt));
  return rows as RenderStyle[];
}

/** 用户:列出启用的输出样式(供 chat 工具栏选择)。全局共享,带缓存。 */
export async function listEnabledRenderStyles(): Promise<RenderStyle[]> {
  await requireSession();
  return cacheWrap(ENABLED_RENDER_STYLES_KEY, async () => {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const rows = await db
      .select({
        id: s.renderStyles.id,
        name: s.renderStyles.name,
        description: s.renderStyles.description,
        cssClass: s.renderStyles.cssClass,
        css: s.renderStyles.css,
        icon: s.renderStyles.icon,
        renderer: s.renderStyles.renderer,
        builtin: s.renderStyles.builtin,
        enabled: s.renderStyles.enabled,
        sortOrder: s.renderStyles.sortOrder,
      })
      .from(s.renderStyles)
      .where(eq(s.renderStyles.enabled, true))
      .orderBy(asc(s.renderStyles.sortOrder), asc(s.renderStyles.createdAt));
    return rows as RenderStyle[];
  });
}

/** 读取单个输出样式(用于聊天页聚合注入 CSS)。不鉴权(内部调用,layout 已在受保护路由下)。 */
export async function getRenderStyle(id: string): Promise<RenderStyle | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [row] = await db.select().from(s.renderStyles).where(eq(s.renderStyles.id, id)).limit(1);
  return (row as RenderStyle | undefined) ?? null;
}

/** 校验 cssClass 唯一(排除自身)。冲突时抛错,由上层表单呈现。 */
async function assertCssClassUnique(cssClass: string, excludeId?: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = await db
    .select({ id: s.renderStyles.id })
    .from(s.renderStyles)
    .where(eq(s.renderStyles.cssClass, cssClass));
  const clash = rows.find((r: { id: string }) => r.id !== excludeId);
  if (clash) throw new Error("cssClass 已存在,请换一个标识");
}

/** 管理员:创建输出样式。新建项默认放末尾(sortOrder = 当前 max + 1)。 */
export async function createRenderStyle(input: {
  name: string;
  description?: string;
  cssClass: string;
  css: string;
  icon?: string;
}): Promise<RenderStyle> {
  await requireAdmin();
  await assertCssClassUnique(input.cssClass);
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // 查当前最大 sortOrder,新项排在末尾(空表时从 0 起)。
  const [maxRow] = await db
    .select({ maxSort: sql<number>`coalesce(max(${s.renderStyles.sortOrder}), -1)` })
    .from(s.renderStyles);
  const nextSort = (maxRow?.maxSort ?? -1) + 1;
  const [row] = await db
    .insert(s.renderStyles)
    .values({
      name: input.name,
      description: input.description ?? null,
      cssClass: input.cssClass,
      css: input.css,
      icon: input.icon ?? null,
      sortOrder: nextSort,
    })
    .returning();
  await cacheDel(ENABLED_RENDER_STYLES_KEY).catch(() => {});
  return row as RenderStyle;
}

/**
 * 管理员:按拖动后的 id 顺序全表重写 sortOrder 为连续整数 0,1,2…
 * 单事务包裹,中途失败整体回滚。id 不存在自然跳过(update 0 行),不抛错。
 */
export async function reorderRenderStyles(orderedIds: string[]): Promise<void> {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(s.renderStyles).set({ sortOrder: i }).where(eq(s.renderStyles.id, orderedIds[i]));
    }
  });
  await cacheDel(ENABLED_RENDER_STYLES_KEY).catch(() => {});
}

/** 管理员:更新输出样式。 */
export async function updateRenderStyle(
  id: string,
  patch: Partial<Pick<RenderStyle, "name" | "description" | "cssClass" | "css" | "icon" | "enabled" | "sortOrder">>,
): Promise<void> {
  await requireAdmin();
  // 内置预设的 cssClass 不允许改(会破坏已发布 CSS 的选择器约定)
  if (patch.cssClass !== undefined) await assertCssClassUnique(patch.cssClass, id);
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.update(s.renderStyles).set({ ...patch, updatedAt: new Date() }).where(eq(s.renderStyles.id, id));
  await cacheDel(ENABLED_RENDER_STYLES_KEY).catch(() => {});
}

/** 管理员:删除输出样式。内置预设禁止删除。 */
export async function deleteRenderStyle(id: string): Promise<void> {
  await requireAdmin();
  const existing = await getRenderStyle(id);
  if (existing?.builtin) throw new Error("系统内置样式不可删除");
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.delete(s.renderStyles).where(eq(s.renderStyles.id, id));
  await cacheDel(ENABLED_RENDER_STYLES_KEY).catch(() => {});
}
