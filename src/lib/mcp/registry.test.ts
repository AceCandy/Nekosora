import { describe, expect, it, vi } from "vitest";
import {
  callMcpTool,
  parseQualifiedToolName,
  qualifyToolName,
  toIRTools,
  type McpClientHandle,
  type ResolvedMcpServer,
} from "@/lib/mcp/registry";

function makeServer(name: string, id = name): {
  server: ResolvedMcpServer;
  client: McpClientHandle;
} {
  const client: McpClientHandle = {
    callTool: vi.fn().mockResolvedValue({ content: id, isError: false }),
    listTools: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    server: {
      id,
      name,
      tools: [{ serverId: id, serverName: name, name: "read" }],
      client,
    },
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
    ).resolves.toEqual({ result: "my--server", isError: false });

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

  it("同名全局与 BYO server 获得唯一前缀并分别路由", async () => {
    const global = makeServer("filesystem", "global");
    const byo = makeServer("filesystem", "byo");
    const servers = [global.server, byo.server];
    const names = toIRTools(servers).map((tool) => tool.function.name);

    expect(names).toEqual(["filesystem__read", "filesystem_2__read"]);
    await expect(callMcpTool(servers, "tc-global", names[0], {})).resolves.toEqual({
      result: "global",
      isError: false,
    });
    await expect(callMcpTool(servers, "tc-byo", names[1], {})).resolves.toEqual({
      result: "byo",
      isError: false,
    });

    expect(global.client.callTool).toHaveBeenCalledOnce();
    expect(byo.client.callTool).toHaveBeenCalledOnce();
  });

  it("规范化后同名的不同名称获得唯一前缀", () => {
    const dashed = makeServer("my-server", "dashed");
    const underscored = makeServer("my_server", "underscored");

    expect(
      toIRTools([dashed.server, underscored.server]).map(
        (tool) => tool.function.name,
      ),
    ).toEqual(["my_server__read", "my_server_2__read"]);
  });

  it("分配后缀时避开天然占用名称并保持路由唯一", async () => {
    const first = makeServer("x", "first");
    const duplicate = makeServer("x", "duplicate");
    const naturalSuffix = makeServer("x_2", "natural-suffix");
    const servers = [first.server, duplicate.server, naturalSuffix.server];
    const names = toIRTools(servers).map((tool) => tool.function.name);

    expect(names).toEqual(["x__read", "x_2__read", "x_2_2__read"]);
    const results = await Promise.all(
      names.map((name, index) =>
        callMcpTool(servers, `tc-${index}`, name, {}),
      ),
    );

    expect(results.map((result) => result.result)).toEqual([
      "first",
      "duplicate",
      "natural-suffix",
    ]);
  });
});
