/**
 * OpenAI 兼容端点 —— GET /v1/models
 * 返回该 key 可用的模型列表(全局 public ∪ 子 key 绑定的)。
 */
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { verifyKey, extractBearer } from "@/lib/keys";
import { apiErrorLocalized, ErrorCode } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) {
    return apiErrorLocalized(ErrorCode.AUTH_MISSING_KEY, req);
  }
  const verified = await verifyKey(rawKey);
  if (!verified) {
    return apiErrorLocalized(ErrorCode.AUTH_INVALID_KEY, req);
  }

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const { ctx, record } = verified;

  const models: { id: string; object: string; created: number; owned_by: string }[] = [];
  const seen = new Set<string>();
  const add = (id: string, ownedBy = "nekusora") => {
    if (seen.has(id)) return;
    seen.add(id);
    models.push({ id, object: "model", created: Math.floor(Date.now() / 1000), owned_by: ownedBy });
  };

  // 子 key:仅返回绑定的模型。
  if (ctx.keyKind === "sub") {
    const bindings = await db
      .select()
      .from(s.keyModelBindings)
      .where(eq(s.keyModelBindings.keyId, record.id));

    for (const b of bindings) {
      if (b.scope === "global" && b.globalModelId) {
        const [m] = await db
          .select()
          .from(s.globalModels)
          .where(and(eq(s.globalModels.id, b.globalModelId), eq(s.globalModels.enabled, true)))
          .limit(1);
        if (m) add(m.name, m.vendor ?? "nekusora");
      } else if (b.scope === "byo" && b.userModelId) {
        const [m] = await db
          .select()
          .from(s.userModels)
          .where(and(eq(s.userModels.id, b.userModelId), eq(s.userModels.enabled, true)))
          .limit(1);
        if (m) add(m.name, "user");
      }
    }
  } else {
    // 主 key:全局 public & enabled ∪ 该用户的 BYO 模型。
    const globals = await db
      .select()
      .from(s.globalModels)
      .where(and(eq(s.globalModels.accessScope, "public"), eq(s.globalModels.enabled, true)));
    for (const m of globals) add(m.name, m.vendor ?? "nekusora");

    const byos = await db
      .select()
      .from(s.userModels)
      .where(and(eq(s.userModels.userId, ctx.userId), eq(s.userModels.enabled, true)));
    for (const m of byos) add(m.name, "user");
  }

  return NextResponse.json({ object: "list", data: models });
}
