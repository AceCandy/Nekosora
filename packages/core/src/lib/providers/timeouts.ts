export const PROVIDER_TIMEOUT_LIMITS = {
  connectTimeoutMs: { defaultMs: 60_000, minMs: 1_000, maxMs: 300_000 },
  readTimeoutMs: { defaultMs: 900_000, minMs: 10_000, maxMs: 3_600_000 },
  streamIdleTimeoutMs: { defaultMs: 120_000, minMs: 5_000, maxMs: 900_000 },
} as const;

export type ProviderTimeoutKind = "connect" | "read" | "stream_idle";

export interface ProviderTimeoutConfig {
  connectTimeoutMs?: number | null;
  readTimeoutMs?: number | null;
  streamIdleTimeoutMs?: number | null;
}

export interface EffectiveProviderTimeouts {
  connectTimeoutMs: number;
  readTimeoutMs: number;
  streamIdleTimeoutMs: number;
}

export function pickProviderTimeoutConfig(config: ProviderTimeoutConfig): ProviderTimeoutConfig {
  return {
    connectTimeoutMs: config.connectTimeoutMs,
    readTimeoutMs: config.readTimeoutMs,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
  };
}

export class ProviderTimeoutError extends Error {
  readonly code = "gateway.timeout";

  constructor(
    readonly kind: ProviderTimeoutKind,
    readonly timeoutMs: number,
  ) {
    super(`Provider ${kind} timeout after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export function resolveProviderTimeouts(config: ProviderTimeoutConfig): EffectiveProviderTimeouts {
  return {
    connectTimeoutMs: config.connectTimeoutMs ?? PROVIDER_TIMEOUT_LIMITS.connectTimeoutMs.defaultMs,
    readTimeoutMs: config.readTimeoutMs ?? PROVIDER_TIMEOUT_LIMITS.readTimeoutMs.defaultMs,
    streamIdleTimeoutMs:
      config.streamIdleTimeoutMs ?? PROVIDER_TIMEOUT_LIMITS.streamIdleTimeoutMs.defaultMs,
  };
}

const FORM_FIELDS = {
  connectTimeoutMs: { name: "connectTimeoutSeconds", label: "连接" },
  readTimeoutMs: { name: "readTimeoutSeconds", label: "总读取" },
  streamIdleTimeoutMs: { name: "streamIdleTimeoutSeconds", label: "流空闲" },
} as const;

export function parseProviderTimeoutFormData(formData: FormData): {
  connectTimeoutMs: number | null;
  readTimeoutMs: number | null;
  streamIdleTimeoutMs: number | null;
} {
  return {
    connectTimeoutMs: parseSeconds(formData, "connectTimeoutMs"),
    readTimeoutMs: parseSeconds(formData, "readTimeoutMs"),
    streamIdleTimeoutMs: parseSeconds(formData, "streamIdleTimeoutMs"),
  };
}

function parseSeconds(
  formData: FormData,
  field: keyof typeof PROVIDER_TIMEOUT_LIMITS,
): number | null {
  const { name, label } = FORM_FIELDS[field];
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return null;

  const milliseconds = Number(raw) * 1_000;
  const { minMs, maxMs } = PROVIDER_TIMEOUT_LIMITS[field];
  if (!Number.isFinite(milliseconds) || !Number.isInteger(milliseconds)
    || milliseconds < minMs || milliseconds > maxMs) {
    throw new Error(`${label}超时必须在 ${minMs / 1_000} 到 ${maxMs / 1_000} 秒之间，最多三位小数`);
  }
  return milliseconds;
}

export function isProviderTimeoutError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let index = 0; index < pending.length && index < 8; index += 1) {
    const current = pending[index];
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    if (current instanceof ProviderTimeoutError) return true;
    if (current instanceof Error && current.name === "TimeoutError") return true;
    if (typeof current === "object") {
      const nested = current as { lastError?: unknown; cause?: unknown };
      if (nested.lastError !== undefined) pending.push(nested.lastError);
      if (nested.cause !== undefined) pending.push(nested.cause);
    }
  }
  return false;
}

export interface ProviderTimeoutScope {
  signal: AbortSignal;
  dispose(): void;
}

export function createProviderTimeoutScope(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  kind: ProviderTimeoutKind,
): ProviderTimeoutScope {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onParentAbort = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else {
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    timer = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort(new ProviderTimeoutError(kind, timeoutMs));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

async function debugProviderResponseBody(response: Response, path: string): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const chunks: Uint8Array[] = [];
  let bodyBytes = 0;
  let truncated = false;
  while (bodyBytes < 65_536) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = 65_536 - bodyBytes;
    chunks.push(value.subarray(0, remaining));
    bodyBytes += Math.min(value.byteLength, remaining);
    if (value.byteLength > remaining) truncated = true;
  }
  if (bodyBytes >= 65_536) {
    truncated = true;
    await reader.cancel();
  }

  const text = new TextDecoder().decode(Buffer.concat(chunks));
  const data = text.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  const topLevelKeys = new Set<string>();
  const partKeys = new Set<string>();
  let jsonEventCount = 0;
  let doneMarkerCount = 0;
  for (const item of data) {
    if (item === "[DONE]") {
      doneMarkerCount += 1;
      continue;
    }
    try {
      const parsed = JSON.parse(item) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      jsonEventCount += 1;
      Object.keys(parsed).forEach((key) => topLevelKeys.add(key));
      const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
        const content = (candidate as Record<string, unknown>).content;
        if (!content || typeof content !== "object" || Array.isArray(content)) continue;
        const parts = (content as Record<string, unknown>).parts;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          if (part && typeof part === "object" && !Array.isArray(part)) {
            Object.keys(part).forEach((key) => partKeys.add(key));
          }
        }
      }
    } catch {
      // 非 JSON data 事件只计入总数。
    }
  }
  console.info("[gateway:debug] upstream-body", JSON.stringify({
    path,
    bodyBytes,
    truncated,
    dataEventCount: data.length,
    jsonEventCount,
    doneMarkerCount,
    topLevelKeys: [...topLevelKeys].sort(),
    partKeys: [...partKeys].sort(),
  }));
}

export function createProviderFetch(options: {
  connectTimeoutMs?: number | null;
  userAgent?: string;
} = {}): typeof globalThis.fetch {
  const connectTimeoutMs = options.connectTimeoutMs
    ?? PROVIDER_TIMEOUT_LIMITS.connectTimeoutMs.defaultMs;

  return async (input, init) => {
    const timeoutController = new AbortController();
    const inputSignal = init?.signal
      ?? (input instanceof Request ? input.signal : undefined);
    const signal = inputSignal
      ? AbortSignal.any([inputSignal, timeoutController.signal])
      : timeoutController.signal;
    const timer = setTimeout(() => {
      timeoutController.abort(new ProviderTimeoutError("connect", connectTimeoutMs));
    }, connectTimeoutMs);
    const headers = options.userAgent
      ? new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      : undefined;
    headers?.set("user-agent", options.userAgent ?? "");
    const debug = process.env.GATEWAY_DEBUG_REQUESTS === "true";

    if (debug) {
      const url = input instanceof Request ? input.url : String(input);
      const body = init?.body;
      const summary: Record<string, unknown> = {
        method: init?.method ?? (input instanceof Request ? input.method : "GET"),
        path: new URL(url).pathname,
        bodyBytes: typeof body === "string" ? new TextEncoder().encode(body).byteLength : undefined,
      };
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            summary.bodyKeys = Object.keys(parsed).sort();
            for (const key of ["messages", "contents", "tools"]) {
              if (Array.isArray(parsed[key])) summary[`${key}Count`] = parsed[key].length;
            }
            if (Array.isArray(parsed.contents)) {
              const roles: Record<string, number> = {};
              for (const content of parsed.contents) {
                if (!content || typeof content !== "object" || Array.isArray(content)) continue;
                const role = (content as Record<string, unknown>).role;
                const safeRole = role === "user" || role === "model" ? role : "unknown";
                roles[safeRole] = (roles[safeRole] ?? 0) + 1;
              }
              summary.contentRoles = roles;
            }
            if (parsed.generationConfig && typeof parsed.generationConfig === "object") {
              const config = parsed.generationConfig as Record<string, unknown>;
              summary.generationConfigKeys = Object.keys(config).sort();
              for (const key of ["maxOutputTokens", "temperature", "topP"]) {
                if (typeof config[key] === "number") summary[key] = config[key];
              }
              if (config.thinkingConfig && typeof config.thinkingConfig === "object") {
                const thinking = config.thinkingConfig as Record<string, unknown>;
                summary.thinkingConfigKeys = Object.keys(thinking).sort();
                for (const key of ["thinkingBudget", "thinkingLevel", "includeThoughts"]) {
                  if (["number", "string", "boolean"].includes(typeof thinking[key])) {
                    summary[key] = thinking[key];
                  }
                }
              }
            }
            summary.hasSystemInstruction = parsed.systemInstruction !== undefined;
          }
        } catch {
          // 非 JSON 上游请求只记录字节数。
        }
      }
      console.info("[gateway:debug] upstream-request", JSON.stringify(summary));
    }

    try {
      const response = await globalThis.fetch(input, {
        ...init,
        ...(headers ? { headers } : {}),
        signal,
      });
      if (debug) {
        const url = input instanceof Request ? input.url : String(input);
        const path = new URL(url).pathname;
        console.info("[gateway:debug] upstream-response", JSON.stringify({
          path,
          status: response.status,
          contentType: response.headers.get("content-type"),
        }));
        void debugProviderResponseBody(response.clone(), path).catch(() => undefined);
      }
      return response;
    } catch (error) {
      if (signal.aborted && signal.reason !== undefined) throw signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
