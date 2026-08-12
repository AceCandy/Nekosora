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

    try {
      return await globalThis.fetch(input, {
        ...init,
        ...(headers ? { headers } : {}),
        signal,
      });
    } catch (error) {
      if (signal.aborted && signal.reason !== undefined) throw signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
