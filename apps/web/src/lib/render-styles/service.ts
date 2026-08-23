/**
 * 输出样式服务 —— 管理员预设的会话级 Markdown 渲染样式。
 *
 * 每个样式含一段 css 与一个稳定 cssClass,选定后给 AI 回答正文容器套上
 * rs-{cssClass} 类,CSS 经聊天页聚合注入后作用于渲染。纯渲染层,不影响模型输出。
 * 全局配置(管理员域),所有用户共享;用户在 chat 工具栏选用,写入 conversations.renderStyleId。
 */
import { eq, asc } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { cacheWrap, cacheDel } from "@/lib/infra/cache";
import { requireSession, requireAdmin } from "@/lib/session";
import { getSettingsRevision } from "@/lib/settings-control/service";

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
  const revision = await getSettingsRevision();
  return cacheWrap(`${ENABLED_RENDER_STYLES_KEY}:${revision}`, async () => {
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

export async function invalidateRenderStylesCache(revision: number): Promise<void> {
  await cacheDel(`${ENABLED_RENDER_STYLES_KEY}:${revision}`);
}

/** 读取单个输出样式(用于聊天页聚合注入 CSS)。不鉴权(内部调用,layout 已在受保护路由下)。 */
export async function getRenderStyle(id: string): Promise<RenderStyle | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [row] = await db.select().from(s.renderStyles).where(eq(s.renderStyles.id, id)).limit(1);
  return (row as RenderStyle | undefined) ?? null;
}
