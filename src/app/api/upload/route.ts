/**
 * 文件上传端点 —— POST /api/upload
 *
 * 流程:
 *   1. session 鉴权
 *   2. 经 StorageDriver 存储文件(key = {userId}/{fileId}-{filename})
 *   3. 写 file_objects(processing_status=pending,storage_path 存 key)
 *   4. 入队 file-process(队列可用时)/ 同步处理(队列不可用时 fallback)
 *
 * 返回 fileId,前端把它与消息关联。
 *
 * 存储后端由 STORAGE_DRIVER 选择(默认 local,S3/R2/MinIO 可配),
 * 见 src/lib/infra/storage。storage_path 列存 driver 无关的 key。
 */
import { type NextRequest, NextResponse } from "next/server";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSession } from "@/lib/session";
import { getQueue } from "@/lib/infra/queue";
import { getStorage } from "@/lib/infra/storage";
import { processFile } from "@/lib/rag/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  const conversationId = String(formData.get("conversationId") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "文件超过 10MB 限制" }, { status: 413 });
  }

  const fileId = crypto.randomUUID();
  // storage key:driver 无关的相对路径。LocalDriver 拼成 ./uploads/{userId}/...
  // 与历史绝对路径一致;S3 driver 作为 object key。
  const storagePath = `${user.id}/${fileId}-${file.name}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const storage = await getStorage();
  await storage.put(storagePath, buf, file.type || "application/octet-stream");

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.insert(s.fileObjects).values({
    id: fileId,
    userId: user.id,
    conversationId: conversationId || null,
    filename: file.name,
    mime: file.type || "application/octet-stream",
    storagePath,
    size: file.size,
    processingStatus: "pending",
  });

  // 入队或同步处理
  const queue = await getQueue();
  if (queue.available) {
    await queue.send("file-process", { fileId, storagePath, mime: file.type });
  } else {
    // 队列不可用时:同步处理(不阻塞响应过多 —— 简单起见在后台 fire-and-forget)
    processFile(fileId, storagePath, file.type || "application/octet-stream").catch((e) =>
      console.error("[upload] sync process failed:", e),
    );
  }

  return NextResponse.json({ fileId, filename: file.name, status: "processing" });
}
