/**
 * 知识库检索调试端点 —— POST /api/knowledge/search
 * 供管理面板输入 query,查看在指定知识库下的召回块。
 */
import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getFileIdsByKnowledgeBases } from "@/lib/knowledge-base/service";
import { retrieve } from "@/lib/rag/retrieve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as { query: string; kbIds: string[] };
  if (!body.query || !Array.isArray(body.kbIds)) {
    return NextResponse.json({ error: "缺少 query/kbIds" }, { status: 400 });
  }

  const fileIds = await getFileIdsByKnowledgeBases(body.kbIds);
  if (fileIds.length === 0) {
    return NextResponse.json({ status: "empty", chunks: [] });
  }

  const result = await retrieve(body.query, fileIds, { topK: 5 });
  return NextResponse.json({ status: result.status, chunks: result.chunks, maxScore: result.maxScore });
}
