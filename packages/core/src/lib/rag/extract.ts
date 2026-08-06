/**
 * 文本提取 —— 从上传文件提取纯文本。
 *
 * 当前支持:txt/md/csv/json/html/代码文件(纯文本类)。
 * pdf/docx 等:留作扩展(可接 Tika/Docling);未识别类型时标记 rag_reason="unsupported"。
 *
 * 图片(image/*):跳过文本提取(P1-C vision 走 multimodal 路径,不走 RAG),
 * 标记 rag_reason="image_skipped",避免被误判为处理失败。
 *
 * 提取结果同时返回字符数和(可估的)页数。
 *
 * 入参 key 为 StorageDriver 无关的 key(见 src/lib/infra/storage)。
 * 旧记录的绝对路径仍兼容(LocalDriver 内部处理)。
 */
import { getStorage } from "@/lib/infra/storage";

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl",
  ".html", ".htm", ".xml", ".yaml", ".yml", ".log",
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".sh", ".sql", ".css", ".less", ".scss",
]);

export interface ExtractResult {
  text: string;
  chars: number;
  pages: number | null;
  supported: boolean;
  reason?: string;
}

/** 从 storage key 提取文本(key 末段即文件名,取扩展名)。 */
export async function extractText(key: string, mime: string): Promise<ExtractResult> {
  const dotIdx = key.lastIndexOf(".");
  const ext = dotIdx >= 0 ? key.slice(dotIdx).toLowerCase() : "";

  // PDF / Office —— 扩展点,暂不支持
  if (ext === ".pdf" || mime.includes("pdf")) {
    return { text: "", chars: 0, pages: null, supported: false, reason: "pdf_not_supported" };
  }
  if ([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(ext)) {
    return { text: "", chars: 0, pages: null, supported: false, reason: "office_not_supported" };
  }
  // 图片(P1-C vision 预埋):跳过文本提取,不视为失败。
  if (mime.startsWith("image/")) {
    return { text: "", chars: 0, pages: null, supported: false, reason: "image_skipped" };
  }

  // 纯文本类
  const isText = TEXT_EXTS.has(ext) || mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
  if (!isText) {
    return { text: "", chars: 0, pages: null, supported: false, reason: "unsupported_type" };
  }

  const storage = await getStorage();
  const buf = await storage.get(key);
  const text = buf.toString("utf-8");
  const chars = text.length;
  // 粗估页数:每 2000 字符一页
  const pages = chars > 0 ? Math.max(1, Math.ceil(chars / 2000)) : null;
  return { text, chars, pages, supported: true };
}
