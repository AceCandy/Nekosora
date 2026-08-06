/**
 * 文件上传端点 —— POST /api/upload
 *
 * 流程:
 *   1. session 鉴权
 *   2. 校验可选 conversationId 属于当前用户
 *   3. 经 StorageDriver 存储文件(key = {userId}/{fileId}-{filename})
 *   4. 写 file_objects(processing_status=pending,storage_path 存 key)
 *   5. 入队 file-process(队列可用时)/ 同步处理(队列不可用时 fallback)
 *
 * 返回 fileId,前端把它与消息关联。
 *
 * 存储后端由 STORAGE_DRIVER 选择(默认 local,S3/R2/MinIO 可配),
 * 见 src/lib/infra/storage。storage_path 列存 driver 无关的 key。
 */
import { and, eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { getSessionFromHeaders } from "@/lib/session-request";
import { getQueue } from "@/lib/infra/queue";
import { FILE_PROCESS_QUEUE } from "@/lib/jobs/catalog";
import { getStorage } from "@/lib/infra/storage";
import { processFile } from "@/lib/rag/processing-coordinator";
import { formatFileProcessingError } from "@/lib/rag/processing-state";
import { apiError, ErrorCode } from "@/lib/errors";
import {
  parseBoundedMultipartFormData,
  RequestBodyTooLargeError,
} from "@/lib/multipart";
import {
  MAX_UPLOAD_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
} from "./upload-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeUploadFilename(filename: string): string {
  const basename = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = basename.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return !cleaned || cleaned === "." || cleaned === ".." ? "file" : cleaned;
}

export async function POST(req: Request) {
  const user = await getSessionFromHeaders(req.headers);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await parseBoundedMultipartFormData(req, MAX_UPLOAD_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return apiError(ErrorCode.REQUEST_PAYLOAD_TOO_LARGE, {
        maxFileBytes: MAX_UPLOAD_FILE_BYTES,
      });
    }
    return Response.json({ error: "上传请求格式非法" }, { status: 400 });
  }
  const file = formData.get("file");
  const conversationId = String(formData.get("conversationId") ?? "");
  if (!(file instanceof File)) {
    return Response.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    return apiError(ErrorCode.REQUEST_PAYLOAD_TOO_LARGE, {
      maxFileBytes: MAX_UPLOAD_FILE_BYTES,
    });
  }

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  if (conversationId) {
    const [conversation] = await db
      .select({ id: s.conversations.id })
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.id, conversationId),
          eq(s.conversations.userId, user.id),
        ),
      )
      .limit(1);
    if (!conversation) {
      return Response.json(
        { error: "会话不存在或无权访问" },
        { status: 403 },
      );
    }
  }

  const fileId = crypto.randomUUID();
  const safeFilename = sanitizeUploadFilename(file.name);
  const mime = file.type || "application/octet-stream";
  // storage key:driver 无关的相对路径。LocalDriver 拼成 ./uploads/{userId}/...
  // 与历史绝对路径一致;S3 driver 作为 object key。
  const storagePath = `${user.id}/${fileId}-${safeFilename}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const storage = await getStorage();
  await storage.put(storagePath, buf, mime);

  try {
    await db.insert(s.fileObjects).values({
      id: fileId,
      userId: user.id,
      conversationId: conversationId || null,
      filename: safeFilename,
      mime,
      storagePath,
      size: file.size,
      processingStatus: "pending",
    });
  } catch (error) {
    try {
      await storage.delete(storagePath);
    } catch {
      console.error("[upload] failed to clean up stored file");
    }
    throw error;
  }

  // 入队或同步处理
  let useSyncFallback = false;
  try {
    const queue = await getQueue();
    if (queue.available) {
      await queue.send(FILE_PROCESS_QUEUE, { fileId });
    } else {
      useSyncFallback = true;
    }
  } catch (queueError) {
    console.error(
      "[upload] queue dispatch failed, using sync fallback:",
      formatFileProcessingError(queueError, [storagePath], "队列投递失败"),
    );
    useSyncFallback = true;
  }
  if (useSyncFallback) {
    // 队列不可用或投递失败时:后台 fire-and-forget 处理,不阻塞上传响应。
    processFile(fileId).catch((error) =>
      console.error(
        "[upload] sync process failed:",
        formatFileProcessingError(error, [storagePath], "文件处理失败"),
      ),
    );
  }

  return Response.json({ fileId, filename: safeFilename, status: "processing" });
}
