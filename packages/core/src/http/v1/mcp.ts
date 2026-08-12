/**
 * MCP Server 端点 —— POST/GET /v1/mcp
 *
 * P1-A Server 侧:Nekusora 作为 MCP Server,暴露能力给 Claude Desktop / Cursor 等。
 * 用 Streamable HTTP transport(MCP 1.0 推荐的现代 transport)。
 *
 * 鉴权:Authorization: Bearer sk-xxx(复用网关 sk 鉴权)。
 *
 * 暴露工具:
 *   - list_models      列出当前 key 可用模型
 *   - search_knowledge 用 query 检索用户的 RAG 文档
 *
 * 这是最小实现:支持 initialize / tools/list / tools/call 三个核心方法。
 * 不实现完整 session 管理(每次请求独立)。
 */
import { verifyKey, extractBearer } from "@/lib/keys";
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import {
  acquireGatewayGovernanceLease,
  consumeGatewayGovernanceRate,
  runWithGatewayGovernance,
} from "@/lib/gateway-governance/lifecycle";
import type { GatewayGovernancePolicy } from "@/lib/gateway-governance/policy";
import type { GovernanceIdentity } from "@/lib/gateway-governance/repository";
import { retrieve } from "@/lib/rag/retrieve";
import type { CallContext } from "@/lib/providers/types";
import {
  gatewayGovernanceErrorResponse,
  gatewayGovernanceIdentity,
} from "./governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpGovernanceContext {
  identity: GovernanceIdentity;
  policy: GatewayGovernancePolicy;
  requestSignal: AbortSignal;
}

export async function POST(req: Request) {
  // 1. 鉴权
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) return jsonRpcError(null, -32001, "缺少 Authorization: Bearer 头");
  const verified = await verifyKey(rawKey);
  if (!verified) return jsonRpcError(null, -32001, "无效的 API 密钥");

  const ctx = verified.ctx;
  let identity: GovernanceIdentity;
  let policy: GatewayGovernancePolicy;
  try {
    identity = gatewayGovernanceIdentity(ctx);
    policy = await consumeGatewayGovernanceRate({
      identity,
      operation: "mcp.request",
    });
  } catch (error) {
    const response = await gatewayGovernanceErrorResponse(error, req);
    if (response) return response;
    throw error;
  }

  // 2. 解析 JSON-RPC 请求
  let rpc: JsonRpcRequest;
  try {
    rpc = (await req.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  // 3. 派发方法
  const { method, params } = rpc;
  const id = rpc.id ?? null;
  try {
    switch (method) {
      case "initialize":
        return Response.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "nekusora", version: "1.0.0" },
          },
        });

      case "tools/list":
        return Response.json({
          jsonrpc: "2.0",
          id,
          result: { tools: TOOL_DEFS },
        });

      case "tools/call": {
        const toolName = params?.name as string;
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        const result = await handleToolCall(ctx, toolName, args, {
          identity,
          policy,
          requestSignal: req.signal,
        });
        return Response.json({ jsonrpc: "2.0", id, result });
      }

      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    const response = await gatewayGovernanceErrorResponse(error, req);
    if (response) return response;
    return jsonRpcError(id, -32603, "Internal error");
  }
}

// GET:Streamable HTTP 的 SSE 升级端点(简化:返回 405,客户端改用 POST)。
export function GET() {
  return Response.json(
    { error: "请用 POST + JSON-RPC 调用 /v1/mcp" },
    { status: 405 },
  );
}

// ---------------------------------------------------------------------------
// 工具定义与实现
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: "list_models",
    description: "列出当前 API key 可调用的模型。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_knowledge",
    description: "在用户上传的文档中进行语义检索(RAG)。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索查询文本" },
      },
      required: ["query"],
    },
  },
];

async function handleToolCall(
  ctx: CallContext,
  name: string,
  args: Record<string, unknown>,
  governance: McpGovernanceContext,
): Promise<{ content: unknown[]; isError?: boolean }> {
  switch (name) {
    case "list_models": {
      const { resolveRoutesByCapability } = await import("@/lib/routing");
      void resolveRoutesByCapability; // 占位:实际列出可见模型可走专用查询
      const db = await getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = getSchema() as any;
      // 网关语义 owner-only:master key 列出自己的 enabled 模型;sub key 进一步限制为已绑定模型。
      const selection = { name: s.models.name, display: s.models.displayName };
      const models = ctx.keyKind === "sub" && ctx.apiKeyId
        ? await db
            .select(selection)
            .from(s.keyModelBindings)
            .innerJoin(s.models, eq(s.keyModelBindings.modelId, s.models.id))
            .where(and(
              eq(s.keyModelBindings.keyId, ctx.apiKeyId),
              eq(s.models.enabled, true),
              eq(s.models.ownerUserId, ctx.userId),
            ))
        : await db
            .select(selection)
            .from(s.models)
            .where(and(eq(s.models.enabled, true), eq(s.models.ownerUserId, ctx.userId)));
      const text = models
        .map((m: { name: string; display: string }) => `- ${m.name} (${m.display})`)
        .join("\n");
      return { content: [{ type: "text", text: text || "无可用模型" }] };
    }
    case "search_knowledge": {
      const query = String(args.query ?? "");
      if (!query) return { content: [{ type: "text", text: "缺少 query 参数" }], isError: true };
      const handle = await acquireGatewayGovernanceLease({
        identity: governance.identity,
        operation: "mcp.search",
        policy: governance.policy,
        requestSignal: governance.requestSignal,
      });
      return runWithGatewayGovernance(handle, async () => {
        const result = await retrieve(query, [], { userId: ctx.userId, topK: 5 });
        if (result.chunks.length === 0) {
          return { value: { content: [{ type: "text", text: "未找到相关文档" }] } };
        }
        const text = result.chunks
          .map((c, i) => `## 片段 ${i + 1}(${c.filename},相似度 ${c.similarity.toFixed(2)})\n${c.content}`)
          .join("\n\n");
        return { value: { content: [{ type: "text", text }] } };
      });
    }
    default:
      return { content: [{ type: "text", text: `未知工具: ${name}` }], isError: true };
  }
}

function jsonRpcError(id: string | number | null, code: number, message: string) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}
