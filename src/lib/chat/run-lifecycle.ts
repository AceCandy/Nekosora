/**
 * WebChat run 生命周期 —— runs / tool_calls 的写入入口。
 *
 * 职责:
 *   1. 流开始前创建 runs(status=running)
 *   2. tool-call / tool-result 写入 tool_calls
 *   3. 终态收敛:success / failed / interrupted + tokenUsage
 *
 * 约束:
 *   - 所有 DB 写入 best-effort:失败只 console.error,不抛、不阻断模型流
 *   - 经 getDb/getSchema 访问,禁止静态引入 pg 驱动
 *   - 不写完整模型请求/回复;工具入参/出参经 toSafeJsonb 规范化
 */
import { and, eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import {
  isSensitiveFieldName,
  redactErrorMessage,
  redactSensitiveText,
} from "@/lib/redaction";
import type { TokenUsage } from "@/db/types";
import type { IRUsage } from "@/lib/providers/types";

export type RunTerminalStatus = "success" | "failed" | "interrupted";
export type ToolCallWriteStatus = "pending" | "running" | "success" | "failed";

/** 生成与 streamChat / usage 日志一致的 runId。 */
export function createRunId(): string {
  return `run_${crypto.randomUUID()}`;
}

/** IRUsage → messages/runs.tokenUsage 字段形状。 */
export function irUsageToTokenUsage(usage?: IRUsage | null): TokenUsage | null {
  if (!usage) return null;
  const out: TokenUsage = {};
  if (usage.inputTokens != null) out.promptTokens = usage.inputTokens;
  if (usage.outputTokens != null) out.completionTokens = usage.outputTokens;
  if (usage.totalTokens != null) out.totalTokens = usage.totalTokens;
  if (usage.cachedInputTokens != null) out.cacheReadTokens = usage.cachedInputTokens;
  if (usage.reasoningTokens != null) out.reasoningTokens = usage.reasoningTokens;
  return Object.keys(out).length > 0 ? out : null;
}

const MAX_JSON_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_STRING_LEN = 4_000;
const MAX_SERIALIZED_CHARS = 32_000;

/**
 * 把任意值规范为 jsonb 可接受结构:
 * - 脱敏敏感键
 * - 处理循环引用 / BigInt / 函数等不可序列化值
 * - 限制深度与体积
 * 永不抛错。
 */
export function toSafeJsonb(value: unknown): unknown {
  try {
    const seen = new WeakSet<object>();
    const normalized = normalizeJsonValue(value, 0, seen);
    const serialized = JSON.stringify(normalized);
    if (serialized == null) return null;
    if (serialized.length <= MAX_SERIALIZED_CHARS) {
      return JSON.parse(serialized) as unknown;
    }
    return {
      _truncated: true,
      preview: serialized.slice(0, MAX_SERIALIZED_CHARS),
      originalLength: serialized.length,
    };
  } catch {
    return { _unserializable: true };
  }
}

function normalizeJsonValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const safeValue = redactSensitiveText(value);
    return value.length > MAX_STRING_LEN
      ? `${safeValue.slice(0, MAX_STRING_LEN)}…[truncated ${value.length}]`
      : safeValue;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }
  if (depth >= MAX_JSON_DEPTH) return "[MaxDepth]";

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message).slice(0, MAX_STRING_LEN),
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => normalizeJsonValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    }
    return items;
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, child] of entries) {
      if (count >= MAX_OBJECT_KEYS) {
        out._truncatedKeys = entries.length - MAX_OBJECT_KEYS;
        break;
      }
      if (isSensitiveFieldName(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = normalizeJsonValue(child, depth + 1, seen);
      }
      count += 1;
    }
    return out;
  }

  return String(value);
}

function logRunDbFailure(op: string, err: unknown): void {
  const msg = redactErrorMessage(err);
  // 只记操作名 + 短错误,不附带 args/result/密钥。
  console.error(`[run-lifecycle] ${op} failed:`, msg.slice(0, 200));
}

export interface StartRunParams {
  runId: string;
  conversationId: string;
  userId: string;
  platformModelName?: string | null;
  routedBindingCode?: string | null;
  upstreamId?: string | null;
}

/** 流开始前插入 runs(status=running)。失败不抛。 */
export async function startRun(params: StartRunParams): Promise<void> {
  try {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    await db.insert(s.runs).values({
      runId: params.runId,
      conversationId: params.conversationId,
      userId: params.userId,
      platformModelName: params.platformModelName ?? null,
      routedBindingCode: params.routedBindingCode ?? null,
      upstreamId: params.upstreamId ?? null,
      status: "running",
    });
  } catch (err) {
    logRunDbFailure("startRun", err);
  }
}

export interface FinalizeRunParams {
  runId: string;
  status: RunTerminalStatus;
  tokenUsage?: TokenUsage | null;
  firstTokenLatencyMs?: number | null;
}

/**
 * 将 run 从 running 收敛到终态。
 * 仅更新仍为 running 的行,避免重复 finalize 覆盖。
 */
export async function finalizeRun(params: FinalizeRunParams): Promise<void> {
  try {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    await db
      .update(s.runs)
      .set({
        status: params.status,
        tokenUsage: params.tokenUsage ?? null,
        firstTokenLatencyMs: params.firstTokenLatencyMs ?? null,
      })
      .where(and(eq(s.runs.runId, params.runId), eq(s.runs.status, "running")));
  } catch (err) {
    logRunDbFailure("finalizeRun", err);
  }
}

export interface RecordToolCallStartParams {
  runId: string;
  toolCallId: string;
  toolName: string;
  /** 默认 server(MCP);local 预留给内置工具。 */
  toolType?: "server" | "local";
  args?: unknown;
  status?: Extract<ToolCallWriteStatus, "pending" | "running">;
}

/** tool-call 到达:插入 pending/running 行。失败不抛。 */
export async function recordToolCallStart(
  params: RecordToolCallStartParams,
): Promise<void> {
  try {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    await db.insert(s.toolCalls).values({
      runId: params.runId,
      toolCallId: params.toolCallId,
      toolType: params.toolType ?? "server",
      toolName: params.toolName,
      status: params.status ?? "running",
      inputJson: toSafeJsonb(params.args ?? null),
    });
  } catch (err) {
    logRunDbFailure("recordToolCallStart", err);
  }
}

export interface RecordToolCallResultParams {
  runId: string;
  toolCallId: string;
  result?: unknown;
  isError?: boolean;
}

/** tool-result 到达:按 runId+toolCallId 更新 success/failed。失败不抛。 */
export async function recordToolCallResult(
  params: RecordToolCallResultParams,
): Promise<void> {
  try {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const isError = Boolean(params.isError);
    const patch = isError
      ? {
          status: "failed" as const,
          errorJson: toSafeJsonb(params.result ?? { error: true }),
          outputJson: null,
        }
      : {
          status: "success" as const,
          outputJson: toSafeJsonb(params.result ?? null),
          errorJson: null,
        };
    await db
      .update(s.toolCalls)
      .set(patch)
      .where(
        and(
          eq(s.toolCalls.runId, params.runId),
          eq(s.toolCalls.toolCallId, params.toolCallId),
        ),
      );
  } catch (err) {
    logRunDbFailure("recordToolCallResult", err);
  }
}

/**
 * 根据流式结果推导 run 终态。
 * 收尾持久化失败优先 failed;其余 finish 优先 success。
 */
export function resolveRunTerminalStatus(opts: {
  finished: boolean;
  aborted: boolean;
  sawError: boolean;
  persistenceFailed?: boolean;
}): RunTerminalStatus {
  if (opts.persistenceFailed) return "failed";
  if (opts.finished) return "success";
  if (opts.aborted) return "interrupted";
  if (opts.sawError) return "failed";
  return "interrupted";
}
