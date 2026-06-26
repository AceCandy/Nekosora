/**
 * 图像生成历史 —— GET /api/images
 * 返回当前用户的 image_jobs(倒序,限 50 条)。
 */
import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const jobs = await db
    .select({
      id: s.imageJobs.id,
      model: s.imageJobs.model,
      prompt: s.imageJobs.prompt,
      n: s.imageJobs.n,
      size: s.imageJobs.size,
      status: s.imageJobs.status,
      resultUrls: s.imageJobs.resultUrls,
      error: s.imageJobs.error,
      createdAt: s.imageJobs.createdAt,
    })
    .from(s.imageJobs)
    .where(eq(s.imageJobs.userId, user.id))
    .orderBy(desc(s.imageJobs.createdAt))
    .limit(50);
  return NextResponse.json({ jobs });
}
