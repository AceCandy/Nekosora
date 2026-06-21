/**
 * 文件下载端点 —— GET /api/files/[fileId]
 *
 * 填补项目原本缺失的"读取已上传文件"能力(此前 upload 只写不读,
 * 仅 RAG 提取在服务端内部读取)。用途:
 *   - WebChat 附件预览/下载
 *   - P1-C vision 图片在 Composer 里的缩略图回显
 *
 * 流程:
 *   1. session 鉴权
 *   2. 查 file_objects,校验属主(userId === 当前用户)
 *   3. S3 driver + 公网直链 → 302 重定向到 signedUrl(省应用带宽)
 *   4. 否则 storage.get → 流式返回,带正确 Content-Type / Content-Disposition
 *
 * 仅文件属主可访问(非公开分享场景;分享走 message 文本快照,不涉及文件)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSession } from "@/lib/session";
import { getStorage } from "@/lib/infra/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { fileId } = await ctx.params;
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const [file] = await db
    .select()
    .from(s.fileObjects)
    .where(eq(s.fileObjects.id, fileId))
    .limit(1);

  if (!file || file.userId !== user.id) {
    return NextResponse.json({ error: "文件不存在或无权访问" }, { status: 404 });
  }

  const storage = await getStorage();

  // S3 类 driver:优先 302 重定向到预签名 URL,省应用带宽。
  // (publicReadable 已配 CDN 的情况,signedUrl 也会返回公网直链。)
  if (storage.kind !== "local") {
    const url = await storage.signedUrl(file.storagePath, 3600);
    if (url) return NextResponse.redirect(url, { status: 302 });
  }

  // Local / S3 无直链:读字节流式返回。
  let buf: Buffer;
  try {
    buf = await storage.get(file.storagePath);
  } catch {
    return NextResponse.json({ error: "文件内容读取失败" }, { status: 500 });
  }

  const mime = file.mime || "application/octet-stream";
  const filename = encodeURIComponent(file.filename);
  // NextResponse 的 BodyInit 需要 Uint8Array 而非 Buffer(Buffer 是 Node 扩展类型)。
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
      // 属主私有,不缓存。
      "Cache-Control": "private, no-store",
    },
  });
}
