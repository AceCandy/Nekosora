import { eq } from "drizzle-orm";
import { withBestEffortTimeout } from "@/lib/best-effort";
import { getDb, getSchema } from "@/lib/infra/db";
import { observeGatewayAttempt, observeGatewayExecution } from "@/lib/infra/metrics";
import { redactErrorMessage, redactSensitiveText } from "@/lib/redaction";
import type {
  AttemptTelemetry,
  GatewayTelemetryPort,
} from "./types";

export const gatewayTelemetry: GatewayTelemetryPort = {
  async startExecution(input) {
    await bestEffort("start execution", async () => {
      const db = await getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = getSchema() as any;
      await db.insert(s.gatewayExecutions).values({
        id: input.executionId,
        requestId: input.requestId,
        operation: input.operation,
        source: input.ctx.source,
        userId: input.ctx.userId || null,
        apiKeyId: input.ctx.apiKeyId ?? null,
        keyKind: input.ctx.keyKind,
        model: input.model,
        modelId: input.modelId ?? null,
        requestPath: input.requestPath ?? null,
        stream: input.stream,
        status: "running",
        taskKind: input.taskKind ?? null,
        startedAt: new Date(input.startedAt),
      });
    });
  },

  async recordAttempt(input) {
    await bestEffort("record attempt", async () => {
      const db = await getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = getSchema() as any;
      await db.insert(s.gatewayAttempts).values(attemptValues(input));
    });
    try {
      observeGatewayAttempt({
        operation: input.operation,
        status: input.status,
        protocol: input.route.protocol,
      });
    } catch {
      /* metrics 失败不阻断网关请求 */
    }
  },

  async finalizeExecution(input) {
    await bestEffort("finalize execution", async () => {
      const db = await getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = getSchema() as any;
      const route = input.outcome.route;
      const error = input.outcome.error;
      await db
        .update(s.gatewayExecutions)
        .set({
          status: input.outcome.status,
          providerRef: route ? `${route.source}:${route.provider.id}` : null,
          providerName: route?.provider.name ?? null,
          routeId: route?.routeId ?? null,
          routeName: route ? `${route.provider.name} · ${route.upstreamModelName}` : null,
          upstreamModel: route?.upstreamModelName ?? null,
          upstreamKeyMasked: input.outcome.upstreamKeyMasked ?? null,
          httpStatus: error?.httpStatus ?? null,
          errorCode: error?.code ?? null,
          errorMessage: error?.message ? redactSensitiveText(error.message) : null,
          errorPhase: error?.phase ?? null,
          errorType: error?.code ?? null,
          promptTokens: input.outcome.usage.inputTokens ?? 0,
          completionTokens: input.outcome.usage.outputTokens ?? 0,
          cacheReadTokens: input.outcome.usage.cachedInputTokens ?? 0,
          cacheWriteTokens: 0,
          reasoningTokens: input.outcome.usage.reasoningTokens ?? 0,
          imageCount: input.outcome.usage.imageCount ?? null,
          ttsCodePoints: input.outcome.usage.ttsCodePoints ?? null,
          sttSeconds: input.outcome.usage.sttSeconds ?? null,
          latencyMs: input.latencyMs,
          firstTokenLatencyMs: input.firstTokenLatencyMs ?? null,
          completedAt: new Date(input.completedAt),
        })
        .where(eq(s.gatewayExecutions.id, input.initial.executionId));
    });
    try {
      observeGatewayExecution({
        operation: input.initial.operation,
        source: input.initial.ctx.source,
        status: input.outcome.status,
        latencyMs: input.latencyMs,
        promptTokens: input.outcome.usage.inputTokens ?? 0,
        completionTokens: input.outcome.usage.outputTokens ?? 0,
      });
    } catch {
      /* metrics 失败不阻断网关请求 */
    }
  },
};

function attemptValues(input: AttemptTelemetry) {
  return {
    executionId: input.executionId,
    attempt: input.attempt,
    status: input.status,
    providerRef: `${input.route.source}:${input.route.provider.id}`,
    providerName: input.route.provider.name,
    providerProtocol: input.route.protocol,
    routeId: input.route.routeId,
    routeName: `${input.route.provider.name} · ${input.route.upstreamModelName}`,
    upstreamModel: input.route.upstreamModelName,
    upstreamKeyMasked: input.upstreamKeyMasked ?? null,
    httpStatus: input.error?.httpStatus ?? null,
    errorCode: input.error?.code ?? null,
    errorMessage: input.error?.message ? redactSensitiveText(input.error.message) : null,
    errorPhase: input.error?.phase ?? null,
    errorType: input.error?.code ?? null,
    promptTokens: input.usage?.inputTokens ?? 0,
    completionTokens: input.usage?.outputTokens ?? 0,
    cacheReadTokens: input.usage?.cachedInputTokens ?? 0,
    cacheWriteTokens: 0,
    reasoningTokens: input.usage?.reasoningTokens ?? 0,
    imageCount: input.usage?.imageCount ?? null,
    ttsCodePoints: input.usage?.ttsCodePoints ?? null,
    sttSeconds: input.usage?.sttSeconds ?? null,
    latencyMs: input.latencyMs,
    firstTokenLatencyMs: input.firstTokenLatencyMs ?? null,
    startedAt: new Date(input.startedAt),
    completedAt: new Date(input.completedAt),
  };
}

async function bestEffort(label: string, operation: () => Promise<void>): Promise<void> {
  try {
    await withBestEffortTimeout(operation);
  } catch (error) {
    console.error(`[gateway telemetry] ${label} failed:`, redactErrorMessage(error));
  }
}
