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
