# MCP Integration

## 1. Scope / Trigger

Apply this contract when changing MCP client connection setup, transport ownership, timeout behavior, or fallback to cached tools. Nekusora supports stdio, SSE, and Streamable HTTP clients through `src/lib/mcp/registry.ts`.

## 2. Signatures

- `resolveMcpServers(ctx: CallContext): Promise<ResolvedMcpServer[]>`
- `withConnectionTimeout<T>(connect: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T>`
- `connectMcpClient(client, transport, signal): Promise<void>`
- Environment: `MCP_CONNECT_TIMEOUT_MS`, optional, default `5000` milliseconds.

## 3. Contracts

- A connection timeout rejects with the stable message `mcp_connect_timeout` so `resolveMcpServers` records the failure and falls back to `cachedTools`.
- The timeout must both reject on schedule and abort the in-flight connector. A hard timeout alone does not release SSE, fetch, or stdio resources.
- Abort closes the concrete transport and passes the same signal to `Client.connect`.
- Success clears the timer without closing the transport. Stdio then enters the existing pool; SSE/HTTP remain short-lived handles.
- Non-timeout connection errors preserve their original error object and message.

## 4. Validation & Error Matrix

| Condition | Result | Resource action |
| --- | --- | --- |
| Connect completes before timeout | Return handle | Clear timer; keep transport open |
| Timeout wins | Throw `mcp_connect_timeout` | Abort signal and close transport |
| Auth/network/protocol error wins | Propagate original error | Clear timer; SDK failure cleanup applies |
| Signal is already aborted after dynamic import | Reject operation | Close newly created transport before connect |

## 5. Good / Base / Bad Cases

- Good: an SSE server never completes setup; the caller falls back after 5 seconds and the EventSource is closed.
- Base: a healthy stdio server connects before the deadline and remains pooled.
- Bad: `Promise.race` rejects after 5 seconds while the losing connector continues in the background with no reachable handle.

## 6. Tests Required

- Fake timers must assert timeout error, `signal.aborted`, one close request, and zero remaining timers.
- Success must assert the return value, no close request, and zero remaining timers.
- Ordinary failure must assert identity of the original error, no timeout close, and zero remaining timers.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` after registry wiring changes.

## 7. Wrong vs Correct

```typescript
// Wrong: the losing connector remains active after timeout.
await Promise.race([connect(), timeoutPromise]);

// Correct: the timeout keeps a hard deadline and actively cancels owned resources.
await withConnectionTimeout(
  (signal) => connectMcpClient(client, transport, signal),
  timeoutMs,
);
```

## Scenario: Qualified Tool Names

### 1. Scope / Trigger

Apply this contract when changing server-name sanitization, IR tool generation, or tool-call routing. Qualified names use `<normalizedServerName>__<originalToolName>`.

### 2. Signatures

- `qualifyToolName(serverName: string, toolName: string): string`
- `parseQualifiedToolName(qualified: string): { serverName: string; toolName: string } | null`
- `callMcpTool(servers, toolCallId, qualifiedName, args)`

### 3. Contracts

- Normalize every non-alphanumeric/non-underscore server character to `_`, then collapse consecutive underscores to one.
- The normalized server segment must never contain the `__` delimiter.
- Preserve the original tool name after the first delimiter, including any `__` inside the tool name.
- Generation and server lookup must use the same normalization function. Raw server-name equality remains a compatibility fallback.
- Within one resolved server array, assign unique normalized prefixes in order. Keep the first base name, then try `_2`, `_3`, and continue until the candidate is unused.
- Build the same `server.id -> prefix` map for IR generation and tool-call routing. No cross-request registry is required because both operations share the same ordered server array.

### 4. Validation & Error Matrix

| Input | Result |
| --- | --- |
| `my--server` + `read_file` | `my_server__read_file` |
| `my__server` + `read_file` | `my_server__read_file` |
| `my-server` + `read__file` | server=`my_server`, tool=`read__file` |
| Two `filesystem` servers | `filesystem__read`, `filesystem_2__read` |
| `x`, duplicate `x`, natural `x_2` | `x`, `x_2`, `x_2_2` prefixes |
| Unknown normalized server | Existing `MCP server <name> 不可用` result |

### 5. Good / Base / Bad Cases

- Good: `my` and `my--server` coexist; `my_server__read__file` routes only to `my--server`.
- Base: an alphanumeric server name produces the same qualified name as before.
- Bad: replace each `-` independently but keep `__`, causing the parser to split inside the server segment.

### 6. Tests Required

- Cover repeated punctuation and original repeated underscores.
- Cover overlapping short/long server names and assert the intended handle receives the exact tool name and arguments.
- Cover identical names, normalization collisions, and suffixes already occupied by another server.
- Assert handle close behavior and the existing unknown-server result.

### 7. Wrong vs Correct

```typescript
// Wrong: repeated punctuation can create the reserved delimiter.
serverName.replace(/[^a-zA-Z0-9_]/g, "_");

// Correct: collapse underscores before appending the delimiter.
serverName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_");
```

## Scenario: Atomic Multi-Tool Turns

### 1. Scope / Trigger

Apply this contract when changing `streamChatWithTools`, tool-call event translation, or the working messages sent to the next Agent step.

### 2. Signatures

- `streamChatWithTools(opts: StreamChatWithToolsOptions): AsyncGenerator<StreamEvent>`
- `IRMessage.tool_calls?: IRToolCall[]`
- Tool result message: `{ role: "tool", tool_call_id, content }`

### 3. Contracts

- All tool calls emitted by one model step belong to one assistant message.
- Append that assistant message once with the complete ordered `tool_calls` array, then append all matching tool result messages in the same order.
- Tool execution and outward `tool-result` events remain sequential.
- A failed tool still produces its matching tool result message and does not split the assistant turn.

### 4. Validation & Error Matrix

| Condition | Next-step message sequence |
| --- | --- |
| One tool call | `assistant(call-1), tool(call-1)` |
| Two tool calls | `assistant(call-1, call-2), tool(call-1), tool(call-2)` |
| Second tool fails | Same sequence; second tool content carries the failure result |
| No tool calls | No assistant/tool messages are appended by the Agent loop |

### 5. Good / Base / Bad Cases

- Good: two calls are represented by one assistant message followed by two ordered results.
- Base: a single call retains the existing one-assistant/one-tool shape.
- Bad: append `assistant(call-1), tool(call-1), assistant(call-2), tool(call-2)`; providers may reject the second step because one model turn was split.

### 6. Tests Required

- `stream-agent-loop.test.ts` must inspect the second `streamText` request, not only outward events.
- Assert one assistant message contains every call id, name, and serialized argument in order.
- Assert each following tool message has the matching `tool_call_id` and serialized result.
- Keep single-tool, tool-failure, terminal finish, and aggregate usage tests green.

### 7. Wrong vs Correct

```typescript
// Wrong: each call creates a separate assistant turn.
for (const call of pendingToolCalls) {
  messages.push(assistantMessage([call]), toolMessage(call));
}

// Correct: one model step remains one assistant turn.
messages.push(
  assistantMessage(pendingToolCalls),
  ...toolMessages,
);
```
