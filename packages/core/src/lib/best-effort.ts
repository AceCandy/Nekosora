export const BEST_EFFORT_TIMEOUT_MS = 5_000;

export class BestEffortTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Best-effort operation timed out after ${timeoutMs}ms`);
    this.name = "BestEffortTimeoutError";
  }
}

export async function withBestEffortTimeout<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new BestEffortTimeoutError(BEST_EFFORT_TIMEOUT_MS)),
      BEST_EFFORT_TIMEOUT_MS,
    );
    const unref = (timeoutId as unknown as { unref?: () => void }).unref;
    if (typeof unref === "function") unref.call(timeoutId);
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
