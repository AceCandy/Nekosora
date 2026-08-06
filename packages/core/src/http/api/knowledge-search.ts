/**
 * 知识库检索调试端点 —— POST /api/knowledge/search
 * 供管理面板输入 query,查看在指定知识库下的召回块。
 */
import { getSessionFromHeaders } from "@/lib/session-request";
import { getFileIdsByKnowledgeBases } from "@/lib/knowledge-base/files";
import { retrieve } from "@/lib/rag/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionFromHeaders(req.headers);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as { query: string; kbIds: string[] };
  if (!body.query || !Array.isArray(body.kbIds)) {
    return Response.json({ error: "缺少 query/kbIds" }, { status: 400 });
  }

  const fileIds = await getFileIdsByKnowledgeBases(body.kbIds, user.id);
  if (fileIds.length === 0) {
    return Response.json({ status: "empty", chunks: [] });
  }

  const result = await retrieve(body.query, fileIds, { userId: user.id, topK: 5 });
  return Response.json({ status: result.status, chunks: result.chunks, maxScore: result.maxScore });
}
