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
 *   3. 私有 S3 driver → 302 重定向到 signedUrl(省应用带宽)
 *   4. 配置公共 CDN 的 S3 driver → 应用代理读取,避免泄露永久公开的对象 key
 *   5. 否则 storage.get → 流式返回,带正确 Content-Type / Content-Disposition
 *
 * 仅文件属主可访问(非公开分享场景;分享走 message 文本快照,不涉及文件)。
 */
import { eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSessionFromHeaders } from "@/lib/session-request";
import { getStorage } from "@/lib/infra/storage";
import { parseByteRange } from "@/lib/http-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  const user = await getSessionFromHeaders(req.headers);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

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
    return Response.json({ error: "文件不存在或无权访问" }, { status: 404 });
  }

  const size = Number(file.size);
  const rangeHeader = req.headers.get("range");
  const range = rangeHeader ? parseByteRange(rangeHeader, size) : null;
  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  const storage = await getStorage();

  // 私有 S3 类 driver 走临时预签名 URL。配置公共 CDN 时改由应用代理，
  // 避免把 storagePath 暴露后可绕过属主鉴权永久访问。
  if (storage.kind !== "local" && !storage.publicReadable) {
    const url = await storage.signedUrl(file.storagePath, 3600);
    if (url) return new Response(null, { status: 302, headers: { Location: url } });
  }

  // Local / 配置公共产物 URL 的 S3 / 无签名能力的 fallback:由应用读取。
  let buf: Buffer;
  try {
    buf = range
      ? await storage.get(file.storagePath, range)
      : await storage.get(file.storagePath);
  } catch {
    return Response.json({ error: "文件内容读取失败" }, { status: 500 });
  }

  const mime = file.mime || "application/octet-stream";
  const filename = encodeURIComponent(file.filename);
  // Response 的 BodyInit 需要 Uint8Array 而非 Buffer(Buffer 是 Node 扩展类型)。
  return new Response(new Uint8Array(buf), {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      // 属主私有,不缓存。
      "Cache-Control": "private, no-store",
    },
  });
}
