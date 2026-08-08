import { orderedWeightedKeys } from "@/lib/providers/keys";
import { maskKey } from "@/lib/usage";
import type { ResolvedRoute } from "@/lib/providers/types";
import {
  classifyGatewayError,
  isAbortError,
  isFailoverableError,
  isRetryableForKey,
  providerSecrets,
} from "./policy";
import type {
  AttemptTelemetry,
  ExecuteGatewayOptions,
  GatewayExecutionOutcome,
  GatewayRouteSnapshot,
  SafeGatewayError,
  StartExecutionTelemetry,
} from "./types";

const DEFAULT_MAX_KEY_ATTEMPTS = 6;
const ADAPTER_ABORTED = Symbol("adapter-aborted");

export async function executeAtomicGateway<TResult>(
  options: ExecuteGatewayOptions<never, TResult>,
): Promise<GatewayExecutionOutcome<TResult>> {
  const generator = executeGateway(options);
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
  }
}

export async function* executeGateway<TEvent, TResult>(
  options: ExecuteGatewayOptions<TEvent, TResult>,
): AsyncGenerator<TEvent, GatewayExecutionOutcome<TResult>, void> {
  const startedAt = Date.now();
  const executionId = crypto.randomUUID();
  const initial: StartExecutionTelemetry = {
    executionId,
    requestId: options.requestId,
    operation: options.operation,
    ctx: options.ctx,
    model: options.model,
    modelId: options.modelId,
    requestPath: options.requestPath,
    stream: options.operation === "chat.stream",
    taskKind: options.taskKind,
    startedAt,
  };
  await safeTelemetry(() => options.telemetry.startExecution(initial));

  let outcome: GatewayExecutionOutcome<TResult> | undefined;
  let attempt = 0;
  let firstTokenAt: number | undefined;
  let committed = false;
  let stopExecution = false;
  let activeAttempt: {
    route: ResolvedRoute;
    apiKey: string;
    attempt: number;
    startedAt: number;
    firstTokenAt?: number;
  } | undefined;

  try {
    let routes;
    try {
      routes = await options.resolveRoutes();
    } catch (error) {
      const safeError = classifyGatewayError(error);
      outcome = failedOutcome(executionId, safeError, committed);
      return outcome;
    }

    for (const route of routes) {
      if (options.abortSignal?.aborted) {
        outcome = interruptedOutcome(executionId, snapshotRoute(route), committed);
        return outcome;
      }

      const adapter = options.selectAdapter(route);
      if (!adapter) {
        attempt += 1;
        const now = Date.now();
        const error: SafeGatewayError = {
          code: "protocol_not_supported",
          message: `协议 ${route.protocol} 不支持操作 ${options.operation}`,
          phase: "routing",
        };
        await safeTelemetry(() => options.telemetry.recordAttempt({
          executionId,
          attempt,
          operation: options.operation,
          route: snapshotRoute(route),
          status: "rejected",
          error,
          latencyMs: 0,
          startedAt: now,
          completedAt: now,
        }));
        outcome = failedOutcome(executionId, error, committed, snapshotRoute(route));
        continue;
      }

      const keys = orderedWeightedKeys(route.provider.keys).slice(
        0,
        options.maxKeyAttempts ?? DEFAULT_MAX_KEY_ATTEMPTS,
      );
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const apiKey = keys[keyIndex].key;
        const attemptStartedAt = Date.now();
        attempt += 1;
        activeAttempt = { route, apiKey, attempt, startedAt: attemptStartedAt };
        try {
          const iterator = adapter({
            executionId,
            attempt,
            operation: options.operation,
            route,
            apiKey,
            abortSignal: options.abortSignal,
          });
          let result;
          while (true) {
            const next = await nextAdapterOrAbort(iterator, options.abortSignal);
            if (next === ADAPTER_ABORTED) {
              const completedAt = Date.now();
              await safeTelemetry(() => options.telemetry.recordAttempt({
                executionId,
                attempt,
                operation: options.operation,
                route: snapshotRoute(route),
                upstreamKeyMasked: maskKey(apiKey) ?? undefined,
                status: "interrupted",
                latencyMs: completedAt - attemptStartedAt,
                firstTokenLatencyMs: activeAttempt?.firstTokenAt !== undefined
                  ? activeAttempt.firstTokenAt - attemptStartedAt
                  : undefined,
                startedAt: attemptStartedAt,
                completedAt,
              }));
              outcome = interruptedOutcome(
                executionId,
                snapshotRoute(route),
                committed,
                maskKey(apiKey) ?? undefined,
              );
              activeAttempt = undefined;
              closeIterator(iterator);
              return outcome;
            }
            if (next.done) {
              result = next.value;
              break;
            }
            if (next.value.commitsResponse) {
              committed = true;
            }
            if (next.value.firstTokenAt !== undefined) {
              firstTokenAt ??= next.value.firstTokenAt;
              if (activeAttempt) activeAttempt.firstTokenAt ??= next.value.firstTokenAt;
            }
            yield next.value.value;
          }
          const completedAt = Date.now();
          const attemptFirstTokenAt = activeAttempt?.firstTokenAt ?? result.firstTokenAt;
          firstTokenAt ??= attemptFirstTokenAt;
          await safeTelemetry(() => options.telemetry.recordAttempt({
            executionId,
            attempt,
            operation: options.operation,
            route: snapshotRoute(route),
            upstreamKeyMasked: maskKey(apiKey) ?? undefined,
            status: "success",
            usage: result.usage,
            latencyMs: completedAt - attemptStartedAt,
            firstTokenLatencyMs: attemptFirstTokenAt !== undefined
              ? attemptFirstTokenAt - attemptStartedAt
              : undefined,
            startedAt: attemptStartedAt,
            completedAt,
          }));
          activeAttempt = undefined;
          options.breaker.recordSuccess(route.provider.id);
          outcome = {
            executionId,
            status: "success",
            result: result.value,
            usage: result.usage ?? {},
            route: snapshotRoute(route),
            upstreamKeyMasked: maskKey(apiKey) ?? undefined,
            firstTokenAt: attemptFirstTokenAt,
            committed,
          };
          return outcome;
        } catch (error) {
          const completedAt = Date.now();
          if (isAbortError(error) || options.abortSignal?.aborted) {
            await safeTelemetry(() => options.telemetry.recordAttempt({
              executionId,
              attempt,
              operation: options.operation,
              route: snapshotRoute(route),
              upstreamKeyMasked: maskKey(apiKey) ?? undefined,
              status: "interrupted",
              latencyMs: completedAt - attemptStartedAt,
              firstTokenLatencyMs: activeAttempt?.firstTokenAt !== undefined
                ? activeAttempt.firstTokenAt - attemptStartedAt
                : undefined,
              startedAt: attemptStartedAt,
              completedAt,
            }));
            activeAttempt = undefined;
            outcome = interruptedOutcome(
              executionId,
              snapshotRoute(route),
              committed,
              maskKey(apiKey) ?? undefined,
            );
            return outcome;
          }

          const toolUnsupported = options.isToolUnsupported?.(error) === true;
          const classifiedError = classifyGatewayError(error, providerSecrets(route, apiKey));
          const safeError: SafeGatewayError = toolUnsupported
            ? { ...classifiedError, code: "tools_not_supported", phase: "routing" }
            : classifiedError;
          const attemptTelemetry: AttemptTelemetry = {
            executionId,
            attempt,
            operation: options.operation,
            route: snapshotRoute(route),
            upstreamKeyMasked: maskKey(apiKey) ?? undefined,
            status: "failed",
            error: safeError,
            latencyMs: completedAt - attemptStartedAt,
            firstTokenLatencyMs: activeAttempt?.firstTokenAt !== undefined
              ? activeAttempt.firstTokenAt - attemptStartedAt
              : undefined,
            startedAt: attemptStartedAt,
            completedAt,
          };
          await safeTelemetry(() => options.telemetry.recordAttempt(attemptTelemetry));
          activeAttempt = undefined;

          if (toolUnsupported) {
            await safeOperation(() => options.onToolUnsupported?.(route));
          }

          const failoverable = toolUnsupported || isFailoverableError(error);
          if (failoverable && !toolUnsupported) options.breaker.recordFailure(route.provider.id);
          stopExecution = committed || !failoverable;
          outcome = failedOutcome(
            executionId,
            safeError,
            committed,
            snapshotRoute(route),
            maskKey(apiKey) ?? undefined,
          );
          const hasMoreKeys = keyIndex < keys.length - 1;
          if (!committed && !toolUnsupported && hasMoreKeys && isRetryableForKey(error)) continue;
          break;
        }
      }

      if (stopExecution) break;
    }

    outcome ??= failedOutcome(executionId, {
      code: "no_route",
      message: "没有可用路由",
      phase: "routing",
    }, committed);
    return outcome;
  } finally {
    outcome ??= options.abortSignal?.aborted
      ? interruptedOutcome(executionId, undefined, committed)
      : failedOutcome(executionId, {
        code: "execution_incomplete",
        message: "执行未正常收敛",
        phase: "internal",
      }, committed);
    if (outcome.status === "interrupted" && activeAttempt) {
      const completedAt = Date.now();
      const interruptedAttempt = activeAttempt;
      activeAttempt = undefined;
      await safeTelemetry(() => options.telemetry.recordAttempt({
        executionId,
        attempt: interruptedAttempt.attempt,
        operation: options.operation,
        route: snapshotRoute(interruptedAttempt.route),
        upstreamKeyMasked: maskKey(interruptedAttempt.apiKey) ?? undefined,
        status: "interrupted",
        latencyMs: completedAt - interruptedAttempt.startedAt,
        firstTokenLatencyMs: interruptedAttempt.firstTokenAt !== undefined
          ? interruptedAttempt.firstTokenAt - interruptedAttempt.startedAt
          : undefined,
        startedAt: interruptedAttempt.startedAt,
        completedAt,
      }));
    }
    if (firstTokenAt !== undefined) outcome.firstTokenAt ??= firstTokenAt;
    const finalOutcome = outcome;
    const completedAt = Date.now();
    await safeTelemetry(() => options.telemetry.finalizeExecution({
      initial,
      outcome: finalOutcome,
      latencyMs: completedAt - startedAt,
      firstTokenLatencyMs: firstTokenAt !== undefined ? firstTokenAt - startedAt : undefined,
      completedAt,
    }));
  }
}

async function safeTelemetry(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch {
    /* 观测失败不得改变网关执行结果。 */
  }
}

async function safeOperation(operation: () => Promise<void> | undefined): Promise<void> {
  try {
    await operation();
  } catch {
    /* 能力学习失败不得改变当前请求结果。 */
  }
}

async function nextAdapterOrAbort<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T> | typeof ADAPTER_ABORTED> {
  if (!signal) return iterator.next();
  if (signal.aborted) return ADAPTER_ABORTED;

  let onAbort!: () => void;
  const aborted = new Promise<typeof ADAPTER_ABORTED>((resolve) => {
    onAbort = () => resolve(ADAPTER_ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function closeIterator(iterator: AsyncIterator<unknown>): void {
  if (!iterator.return) return;
  void iterator.return().catch(() => undefined);
}

function failedOutcome<TResult>(
  executionId: string,
  error: SafeGatewayError,
  committed: boolean,
  route?: GatewayExecutionOutcome<TResult>["route"],
  upstreamKeyMasked?: string,
): GatewayExecutionOutcome<TResult> {
  return { executionId, status: "failed", usage: {}, route, upstreamKeyMasked, error, committed };
}

function interruptedOutcome<TResult>(
  executionId: string,
  route: GatewayExecutionOutcome<TResult>["route"],
  committed: boolean,
  upstreamKeyMasked?: string,
): GatewayExecutionOutcome<TResult> {
  return { executionId, status: "interrupted", usage: {}, route, upstreamKeyMasked, committed };
}

function snapshotRoute(route: import("@/lib/providers/types").ResolvedRoute): GatewayRouteSnapshot {
  return {
    modelName: route.modelName,
    upstreamModelName: route.upstreamModelName,
    protocol: route.protocol,
    provider: { id: route.provider.id, name: route.provider.name },
    priority: route.priority,
    weight: route.weight,
    source: route.source,
    routeId: route.routeId,
    modelId: route.modelId,
  };
}
