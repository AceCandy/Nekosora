/**
 * Prompt 模板服务 —— P2-B。
 *
 * 职责:
 *   - listTemplates(ctx)   列出可见模板(builtin + shared + 自己 private)
 *   - getTemplate(id)      取单个模板
 *   - renderTemplate       渲染变量到模板,返回最终 system + user 消息
 *   - incUseCount          使用计数 +1
 *   - create/update/delete 用户模板(builtin 只读)
 *
 * 渲染:简单 {{var}} 替换。缺失变量保留原占位符(不报错,便于调试)。
 */
import { eq, and, or, inArray } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import type { CallContext } from "@/lib/providers/types";
import type { PromptTemplate, TemplateVariable, AgentConfig, TemplateScope } from "./types";

export type { PromptTemplate, TemplateVariable, AgentConfig, TemplateScope };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): PromptTemplate {
  return {
    id: row.id,
    userId: row.userId ?? null,
    scope: row.scope,
    name: row.name,
    description: row.description ?? null,
    category: row.category ?? null,
    icon: row.icon ?? null,
    systemPrompt: row.systemPrompt ?? null,
    userTemplate: row.userTemplate ?? null,
    variables: (row.variables ?? []) as TemplateVariable[],
    recommendedModel: row.recommendedModel ?? null,
    isAgent: !!row.isAgent,
    agentConfig: (row.agentConfig ?? null) as AgentConfig | null,
    enabled: !!row.enabled,
    sortOrder: row.sortOrder ?? 0,
    useCount: row.useCount ?? 0,
  };
}

/** 列出用户可见模板:builtin(全局)+ shared(全局)+ 自己 private。 */
export async function listTemplates(
  ctx: Pick<CallContext, "userId">,
  opts?: { category?: string; agentsOnly?: boolean },
): Promise<PromptTemplate[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const conditions = [
    eq(s.promptTemplates.enabled, true),
    or(
      inArray(s.promptTemplates.scope, ["builtin", "shared"]),
      and(eq(s.promptTemplates.scope, "private"), eq(s.promptTemplates.userId, ctx.userId)),
    ),
  ];
  if (opts?.category) {
    conditions.push(eq(s.promptTemplates.category, opts.category));
  }

  const rows = await db
    .select()
    .from(s.promptTemplates)
    .where(and(...conditions))
    .orderBy(s.promptTemplates.sortOrder, s.promptTemplates.createdAt);

  const all = (rows as unknown[]).map((r) => mapRow(r));
  return opts?.agentsOnly ? all.filter((t) => t.isAgent) : all;
}

/** 取单个模板(校验可见性)。 */
export async function getTemplate(
  ctx: Pick<CallContext, "userId">,
  id: string,
): Promise<PromptTemplate | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [row] = await db.select().from(s.promptTemplates).where(eq(s.promptTemplates.id, id)).limit(1);
  if (!row) return null;
  const t = mapRow(row);
  // private 模板仅属主可见。
  if (t.scope === "private" && t.userId !== ctx.userId) return null;
  return t;
}

/**
 * 渲染模板:把 variables 填入 userTemplate / systemPrompt 的 {{var}} 占位符。
 * 返回最终 system + 首条 user 消息文本(供调用方构造 IRMessage)。
 */
export function renderTemplate(
  template: PromptTemplate,
  variables: Record<string, string>,
): { systemPrompt: string | null; userMessage: string | null } {
  const fill = (text: string | null): string | null => {
    if (!text) return null;
    return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match;
    });
  };
  return {
    systemPrompt: fill(template.systemPrompt),
    userMessage: fill(template.userTemplate),
  };
}

/** 使用计数 +1(失败不阻断)。 */
export async function incUseCount(id: string): Promise<void> {
  try {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    await db
      .update(s.promptTemplates)
      .set({ useCount: (s.promptTemplates.useCount ?? 0) + 1, updatedAt: new Date() } as never)
      .where(eq(s.promptTemplates.id, id));
  } catch {
    /* 计数失败忽略 */
  }
}

/** 创建用户私有模板。 */
export async function createTemplate(
  ctx: Pick<CallContext, "userId">,
  data: Omit<PromptTemplate, "id" | "userId" | "scope" | "useCount"> & { scope?: TemplateScope },
): Promise<string> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const id = crypto.randomUUID();
  await db.insert(s.promptTemplates).values({
    id,
    userId: ctx.userId,
    scope: data.scope ?? "private",
    name: data.name,
    description: data.description ?? null,
    category: data.category ?? null,
    icon: data.icon ?? null,
    systemPrompt: data.systemPrompt ?? null,
    userTemplate: data.userTemplate ?? null,
    variables: data.variables ?? [],
    recommendedModel: data.recommendedModel ?? null,
    isAgent: data.isAgent ?? false,
    agentConfig: data.agentConfig ?? null,
    enabled: data.enabled ?? true,
    sortOrder: data.sortOrder ?? 100,
  });
  return id;
}

/** 删除模板(仅自己的 private/shared)。 */
export async function deleteTemplate(ctx: Pick<CallContext, "userId">, id: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // 仅删自己的;builtin 受保护(userId null 不删)。
  await db
    .delete(s.promptTemplates)
    .where(and(eq(s.promptTemplates.id, id), eq(s.promptTemplates.userId, ctx.userId)));
}
