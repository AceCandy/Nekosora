/**
 * WebChat 图像生成端点 —— POST /api/images/generate
 *
 * 与对外网关 /v1/images/generations 的区别:用 session 鉴权(非 sk),并把任务记录写入 image_jobs。
 * 复用 generateImageViaRoute + StorageDriver(url 模式存图)。
 */
import { eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSessionFromHeaders } from "@/lib/session-request";
import { generateImageViaRoute } from "@/lib/providers/multimodal/image-gen";
import { getStorage } from "@/lib/infra/storage";
import { redactErrorMessage } from "@/lib/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionFromHeaders(req.headers);
  if (!user) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let body: { model: string; modelId?: string; prompt: string; n?: number; size?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体非法" }, { status: 400 });
  }
  if (!body.model || !body.prompt) {
    return Response.json({ error: "缺少 model/prompt" }, { status: 400 });
  }

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 先建一条 pending 任务
  const [job] = await db
    .insert(s.imageJobs)
    .values({
      userId: user.id,
      model: body.model,
      prompt: body.prompt,
      n: Math.min(Math.max(body.n ?? 1, 1), 4),
      size: body.size ?? null,
      status: "pending",
    })
    .returning({ id: s.imageJobs.id });

  const ctx = { userId: user.id, keyKind: null as null, source: "chat" as const };
  try {
    const result = await generateImageViaRoute(ctx, body.model, {
      prompt: body.prompt,
      n: Math.min(Math.max(body.n ?? 1, 1), 4),
      size: body.size as "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792" | undefined,
      responseFormat: "url",
    }, body.modelId);

    // 把生成图存入 StorageDriver,收集 url
    const storage = await getStorage();
    const urls: string[] = [];
    for (const img of result.images) {
      if (img.base64) {
        const buf = Buffer.from(img.base64, "base64");
        const key = `images/${user.id}/${crypto.randomUUID()}.png`;
        const stored = await storage.put(key, buf, "image/png");
        if (stored.url) urls.push(stored.url);
      } else if (img.url) {
        urls.push(img.url);
      }
    }

    await db
      .update(s.imageJobs)
      .set({ status: "done", resultUrls: urls })
      .where(eq(s.imageJobs.id, job.id));

    return Response.json({ jobId: job.id, urls });
  } catch (err) {
    const errorMsg = redactErrorMessage(err, [], "生成失败");
    await db
      .update(s.imageJobs)
      .set({ status: "failed", error: errorMsg })
      .where(eq(s.imageJobs.id, job.id));
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
