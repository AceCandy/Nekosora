import { describe, expect, it, vi } from "vitest";
import {
  callMcpTool,
  parseQualifiedToolName,
  qualifyToolName,
  type McpClientHandle,
  type ResolvedMcpServer,
} from "@/lib/mcp/registry";

function makeServer(name: string): {
  server: ResolvedMcpServer;
  client: McpClientHandle;
} {
  const client: McpClientHandle = {
    callTool: vi.fn().mockResolvedValue({ content: "ok", isError: false }),
    listTools: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    server: { id: name, name, tools: [], client },
    client,
  };
}

describe("MCP qualified tool routing", () => {
  it.each(["my--server", "my__server"])(
    "折叠 server 名称中的连续分隔字符:%s",
    (serverName) => {
      const qualified = qualifyToolName(serverName, "read_file");

      expect(qualified).toBe("my_server__read_file");
      expect(parseQualifiedToolName(qualified)).toEqual({
        serverName: "my_server",
        toolName: "read_file",
      });
    },
  );

  it("精确路由连续标点 server 并保留 tool 名与参数", async () => {
    const short = makeServer("my");
    const target = makeServer("my--server");
    const args = { path: "/tmp/example" };
    const qualified = qualifyToolName(target.server.name, "read__file");

    await expect(
      callMcpTool(
        [short.server, target.server],
        "tool-call-1",
        qualified,
        args,
      ),
    ).resolves.toEqual({ result: "ok", isError: false });

    expect(short.client.callTool).not.toHaveBeenCalled();
    expect(target.client.callTool).toHaveBeenCalledWith("read__file", args);
    expect(target.client.close).toHaveBeenCalledOnce();
  });

  it("未匹配 server 时保持不可用错误", async () => {
    const existing = makeServer("existing");

    await expect(
      callMcpTool(
        [existing.server],
        "tool-call-2",
        "missing__read_file",
        {},
      ),
    ).resolves.toEqual({ result: "MCP server missing 不可用", isError: true });

    expect(existing.client.callTool).not.toHaveBeenCalled();
    expect(existing.client.close).not.toHaveBeenCalled();
  });
});
