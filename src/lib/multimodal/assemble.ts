/**
 * 多模态消息组装 —— P1-C vision 图片。
 *
 * 把用户的文本 + 图片附件组装成 OpenAI multimodal 消息格式:
 *   { role: "user", content: [{type:"text",text:...}, {type:"image_url",image_url:{url:...}}] }
 *
 * 图片 URL 策略(决定上游能否拉取):
 *   - StorageDriver 公网直链(S3+CDN)→ 用公网 URL,省 token
 *   - 否则(本地 / 私有 bucket)→ base64 内联(data URL),避开外网拉取问题
 *
 * 大图压缩:用 sharp(已在 onlyBuiltDependencies)压缩到 ≤512KB 后内联,
 * 避免 base64 膨胀 token 上限。
 */
import { getStorage } from "@/lib/infra/storage";
import { getDb, getSchema } from "@/lib/infra/db";
import { inArray } from "drizzle-orm";
import type { IRMessage } from "@/lib/providers/types";

/** 内联 base64 的体积上限(压缩目标,字节)。 */
const MAX_INLINE_BYTES = 512 * 1024;

/** 图片 mime → data URL scheme。 */
const MIME_OK: Record<string, boolean> = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
  "image/gif": true,
};

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/**
 * 构造一条 multimodal user 消息:文本 + 图片。
 * 若无图片,退化为纯文本消息(content 为 string)。
 */
export async function buildMultimodalUserMessage(
  text: string,
  imageFileIds: string[],
): Promise<IRMessage> {
  if (imageFileIds.length === 0) {
    return { role: "user", content: text };
  }

  const parts: NonNullable<IRMessage["content"]> = [];
  if (text) parts.push({ type: "text", text });

  const storage = await getStorage();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const files = await db
    .select()
    .from(s.fileObjects)
    .where(inArray(s.fileObjects.id, imageFileIds));

  for (const file of files) {
    const mime = file.mime as string;
    if (!isImageMime(mime)) continue;
    const safeMime = MIME_OK[mime] ? mime : "image/png";

    // 公网直链(S3+CDN):用 URL,省 token。
    if (storage.publicReadable) {
      const url = await storage.signedUrl(file.storagePath, 3600);
      if (url) {
        parts.push({ type: "image_url", image_url: { url } });
        continue;
      }
    }

    // 否则:读字节 → 压缩 → base64 内联。
    const buf = await storage.get(file.storagePath);
    const compressed = await compressImage(buf, safeMime);
    const b64 = compressed.toString("base64");
    parts.push({ type: "image_url", image_url: { url: `data:${safeMime};base64,${b64}` } });
  }

  return { role: "user", content: parts };
}

/**
 * 压缩图片到目标体积。失败(无 sharp / 处理出错)则原样返回。
 * 仅对超过阈值的图片压缩;小图直接返回。
 */
async function compressImage(buf: Buffer, mime: string): Promise<Buffer> {
  if (buf.byteLength <= MAX_INLINE_BYTES) return buf;
  try {
    const sharp = (await import("sharp")).default;
    // 按 mime 选格式;jpeg/webp 用质量压缩,png 用调色板。
    if (mime === "image/jpeg") {
      return await sharp(buf).jpeg({ quality: 80 }).toBuffer();
    }
    if (mime === "image/webp") {
      return await sharp(buf).webp({ quality: 80 }).toBuffer();
    }
    // png/gif/其他:转 jpeg 压缩(失真可接受,vision 场景不需要无损)。
    return await sharp(buf).jpeg({ quality: 80 }).toBuffer();
  } catch {
    // sharp 不可用(环境缺依赖)→ 原样返回(可能超 token,由上游报错)。
    return buf;
  }
}
