/**
 * MCP registry —— P1-A Host 侧核心。
 *
 * 职责:
 *   1. resolveMcpServers(ctx) —— 查 mcp_servers 表(enabled + 全局或用户 BYO),
 *      为每个 server 建立 Client 连接,列举其工具。
 *   2. toIRTools(servers) —— 把多 server 工具合并成 IRRequest.tools 格式。
 *   3. callMcpTool(servers, ...) —— 路由工具调用到对应 server 并执行。
 *
 * 连接管理:
 *   - stdio:每 server 维持一个 Client(子进程),模块级 Map 缓存,idle 后回收。
 *   - sse/http:短连接(每次 resolve 重连),简单可靠。后续可优化为长连接。
 *
 * 降级:单个 server 连接失败不阻断 —— 用 cachedTools 兜底或跳过。
 * 加密 envEnc 在此解密(仅运行时持有)。
 */
import { eq, or, isNull, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { decrypt } from "@/lib/infra/crypto";
import {
  connectMcpClient,
  withConnectionTimeout,
} from "@/lib/mcp/connection";
import type { CallContext } from "@/lib/providers/types";
import type { IRToolDef } from "@/lib/providers/types";

/** 连接超时(毫秒)。超时则用 cachedTools 兜底。 */
const CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS ?? 5000);

export interface McpToolDef {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema?: unknown; // JSON Schema(AI SDK tools 需要)
}

/** 一个已解析(已连接)的 MCP server。 */
export interface ResolvedMcpServer {
  id: string;
  name: string;
  tools: McpToolDef[];
  /** 活跃 client(供 callMcpTool 复用);null 表示仅用 cachedTools。 */
  client: McpClientHandle | null;
}

/** MCP client 的最小句柄(抽象出三种 transport)。 */
export interface McpClientHandle {
  callTool(name: string, args: unknown): Promise<{ content: unknown; isError: boolean }>;
  listTools(): Promise<McpToolDef[]>;
  close(): Promise<void>;
}

/** stdio 连接缓存(模块级)。 */
const stdioPool = new Map<string, { handle: McpClientHandle; lastUsed: number }>();

/**
 * 解析当前用户可用的 MCP server(全局 + 自己 BYO),返回已连接实例 + 工具清单。
 * 连接失败的单个 server 跳过(不抛错),用 cachedTools 兜底。
 */
export async function resolveMcpServers(ctx: CallContext): Promise<ResolvedMcpServer[]> {
  const db = await getDb();
  const schema = getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = schema as any;

  // 查全局(userId null)+ 当前用户的 enabled server。
  const rows = await db
    .select()
    .from(s.mcpServers)
    .where(
      and(
        eq(s.mcpServers.enabled, true),
        or(isNull(s.mcpServers.userId), eq(s.mcpServers.userId, ctx.userId)),
      ),
    );

  const out: ResolvedMcpServer[] = [];
  for (const row of rows as McpServerRow[]) {
    try {
      const handle = await connectWithTimeout(row);
      const tools = handle ? await handle.listTools().catch(() => []) : [];
      const effectiveTools = tools.length > 0 ? tools : (row.cachedTools as McpToolDef[] | null) ?? [];
      out.push({ id: row.id, name: row.name, tools: effectiveTools, client: handle });
      // 更新缓存 + 连接时间(失败不阻塞)。
      if (tools.length > 0) {
        await db
          .update(s.mcpServers)
          .set({ cachedTools: tools, lastConnectedAt: new Date(), lastError: null })
          .where(eq(s.mcpServers.id, row.id))
          .catch(() => {});
      }
    } catch (err) {
      // 连接失败:用 cachedTools 兜底,记录 lastError。
      const cached = (row.cachedTools as McpToolDef[] | null) ?? [];
      out.push({ id: row.id, name: row.name, tools: cached, client: null });
      await db
        .update(s.mcpServers)
        .set({ lastError: err instanceof Error ? err.message : "connect_failed" })
        .where(eq(s.mcpServers.id, row.id))
        .catch(() => {});
    }
  }
  return out;
}

/** 带超时连接,超时抛错(上层用 cachedTools 兜底)。 */
async function connectWithTimeout(row: McpServerRow): Promise<McpClientHandle | null> {
  return withConnectionTimeout(
    (signal) => buildConnector(row, signal),
    CONNECT_TIMEOUT_MS,
  );
}

/** 按 transport 类型构造连接逻辑。 */
function buildConnector(
  row: McpServerRow,
  signal: AbortSignal,
): Promise<McpClientHandle | null> {
  switch (row.transport) {
    case "stdio":
      return connectStdio(row, signal);
    case "sse":
      return connectSse(row, signal);
    case "http":
      return connectHttp(row, signal);
    default:
      return Promise.resolve(null);
  }
}

/** stdio 连接(带池化)。 */
async function connectStdio(
  row: McpServerRow,
  signal: AbortSignal,
): Promise<McpClientHandle> {
  const cached = stdioPool.get(row.id);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.handle;
  }
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const env = row.envEnc ? parseEnv(decrypt(row.envEnc)) : undefined;
  const transport = new StdioClientTransport({
    command: row.command!,
    args: row.args ?? [],
    env: env as Record<string, string> | undefined,
  });
  const client = new Client({ name: "nekusora", version: "1.0.0" }, { capabilities: {} });
  await connectMcpClient(client, transport, signal);
  const handle = wrapClient(client, "stdio");
  stdioPool.set(row.id, { handle, lastUsed: Date.now() });
  return handle;
}

/** SSE 连接(短连接)。 */
async function connectSse(
  row: McpServerRow,
  signal: AbortSignal,
): Promise<McpClientHandle> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
  const transport = new SSEClientTransport(new URL(row.url!));
  const client = new Client({ name: "nekusora", version: "1.0.0" }, { capabilities: {} });
  await connectMcpClient(client, transport, signal);
  return wrapClient(client, "sse");
}

/** Streamable HTTP 连接(短连接)。 */
async function connectHttp(
  row: McpServerRow,
  signal: AbortSignal,
): Promise<McpClientHandle> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const transport = new StreamableHTTPClientTransport(new URL(row.url!));
  const client = new Client({ name: "nekusora", version: "1.0.0" }, { capabilities: {} });
  await connectMcpClient(client, transport, signal);
  return wrapClient(client, "http");
}

/**
 * 把 MCP Client 包装成统一 handle(隔离 SDK 类型细节)。
 * listTools 在此时拉取并缓存到闭包,避免重复调用。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapClient(client: any, transport: string): McpClientHandle {
  let cachedTools: McpToolDef[] | null = null;
  return {
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args as object });
      const isError = !!result.isError;
      return { content: result.content, isError };
    },
    async listTools() {
      if (cachedTools) return cachedTools;
      const resp = await client.listTools();
      cachedTools = (resp.tools as unknown[]).map((t) => ({
        serverId: "",
        serverName: "",
        name: (t as { name: string }).name,
        description: (t as { description?: string }).description,
        inputSchema: (t as { inputSchema?: unknown }).inputSchema,
      }));
      return cachedTools;
    },
    async close() {
      // stdio 池化不关(复用);sse/http 短连接用完即关。
      if (transport !== "stdio") {
        try { await client.close(); } catch { /* ignore */ }
      }
    },
  };
}

/**
 * 把多 server 工具合并成 IRRequest.tools 格式。
 * 工具名加 server 前缀避免冲突("filesystem__read_file")。
 */
export function toIRTools(servers: ResolvedMcpServer[]): IRToolDef[] {
  const tools: IRToolDef[] = [];
  for (const server of servers) {
    for (const t of server.tools) {
      tools.push({
        type: "function",
        function: {
          name: qualifyToolName(server.name, t.name),
          description: t.description ?? `${server.name}.${t.name}`,
          parameters: t.inputSchema ?? { type: "object", properties: {} },
        },
      });
    }
  }
  return tools;
}

/** 限定名:serverName__toolName(双下划线分隔)。 */
export function qualifyToolName(serverName: string, toolName: string): string {
  return `${normalizeServerName(serverName)}__${toolName}`;
}

/** 避免 server 名清洗结果包含工具限定名的双下划线分隔符。 */
function normalizeServerName(serverName: string): string {
  return serverName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_");
}

/** 解析限定名回 { serverName, toolName }。 */
export function parseQualifiedToolName(qualified: string): { serverName: string; toolName: string } | null {
  const idx = qualified.indexOf("__");
  if (idx < 0) return null;
  return { serverName: qualified.slice(0, idx), toolName: qualified.slice(idx + 2) };
}

/**
 * 执行一次工具调用。
 * qualifiedName 是 toIRTools 产出的限定名。
 */
export async function callMcpTool(
  servers: ResolvedMcpServer[],
  _toolCallId: string,
  qualifiedName: string,
  args: unknown,
): Promise<{ result: unknown; isError: boolean }> {
  const parsed = parseQualifiedToolName(qualifiedName);
  if (!parsed) {
    return { result: `未知工具名格式: ${qualifiedName}`, isError: true };
  }
  const server = servers.find(
    (sv) => normalizeServerName(sv.name) === parsed.serverName || sv.name === parsed.serverName,
  );
  if (!server || !server.client) {
    return { result: `MCP server ${parsed.serverName} 不可用`, isError: true };
  }
  try {
    const { content, isError } = await server.client.callTool(parsed.toolName, args);
    return { result: content, isError };
  } finally {
    await server.client.close().catch(() => {});
  }
}

/** 解析加密的 env 字符串(KEY=VALUE\n 格式)为对象。 */
function parseEnv(envStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of envStr.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1);
  }
  return out;
}

/** McpServerRow 的松散类型(避免依赖 schema 具体类型)。 */
interface McpServerRow {
  id: string;
  userId: string | null;
  name: string;
  transport: string;
  command: string | null;
  args: string[] | null;
  envEnc: string | null;
  url: string | null;
  cachedTools: unknown[] | null;
}
