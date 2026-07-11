/**
 * OpenAI 兼容端点 —— GET /v1/models
 * 返回该 key 可用的模型列表(网关 owner-only:主 key 列调用者自己的全部 enabled 模型;子 key 仅列绑定的)。
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

  // 网关语义 owner-only:public 对网关不可见,只列调用者自己创建的模型。
  if (ctx.keyKind === "sub") {
    // 子 key:仅返回绑定的模型(收敛后 keyModelBindings 单 modelId)。
    const bindings = await db
      .select()
      .from(s.keyModelBindings)
      .where(eq(s.keyModelBindings.keyId, record.id));

    for (const b of bindings) {
      if (!b.modelId) continue;
      const [m] = await db
        .select()
        .from(s.models)
        .where(and(eq(s.models.id, b.modelId), eq(s.models.enabled, true)))
        .limit(1);
      if (m) add(m.name);
    }
  } else {
    // 主 key:owner 自己的全部 enabled 模型(public + private)。
    const myModels = await db
      .select()
      .from(s.models)
      .where(and(eq(s.models.ownerUserId, ctx.userId), eq(s.models.enabled, true)));
    for (const m of myModels) add(m.name);
  }

  return NextResponse.json({ object: "list", data: models });
}
