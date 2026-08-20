import type { GatewayGovernancePolicy } from "./policy";
import {
  observeGatewayGovernanceFailure,
  observeGatewayGovernanceRejection,
  observeGatewayGovernanceSettlement,
} from "@/lib/infra/metrics";
import {
  createGatewayGovernanceRepository,
  GatewayGovernanceRepository,
  GovernanceRejectedError,
  GovernanceStateError,
  type GatewayGovernanceOperation,
  type GatewayQuotaKind,
  type GovernanceIdentity,
  type GovernanceLease,
  type GovernanceSettlement,
} from "./repository";

export const GOVERNANCE_HEARTBEAT_INTERVAL_MS = 30_000;
const GOVERNANCE_REAPER_INTERVAL_MS = 30_000;
const GOVERNANCE_REAPER_BATCH_SIZE = 25;

export type GatewayGovernanceMetricOperation =
  | GatewayGovernanceOperation
  | "chat.request"
  | "models.list"
  | "mcp.request";

type GatewayGovernanceFailureStage =
  | "repository"
  | "policy_load"
  | "policy_invalid"
  | "rate"
  | "lease"
  | "quota_reserve"
  | "provider_start"
  | "heartbeat"
  | "finalize"
  | "reaper";

export interface BeginGovernanceInput {
  identity: GovernanceIdentity;
  operation: GatewayGovernanceOperation;
  requestSignal?: AbortSignal;
  repository?: GatewayGovernanceRepository;
}

export interface AcquireGovernanceLeaseInput extends BeginGovernanceInput {
  policy: GatewayGovernancePolicy;
}

export interface GovernanceReaperController {
  stop(): Promise<void>;
}

export interface GatewayGovernanceRunResult<T> {
  value: T;
  actualUnits?: number;
}

export class GatewayGovernanceHandle {
  readonly lease: GovernanceLease;
  readonly policy: GatewayGovernancePolicy;
  readonly signal: AbortSignal;

  private readonly abortController = new AbortController();
  private readonly repository: GatewayGovernanceRepository;
  private readonly requestSignal?: AbortSignal;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInFlight: Promise<void> | null = null;
  private providerStartedPromise: Promise<void> | null = null;
  private finalizePromise: Promise<GovernanceSettlement> | null = null;
  private stopped = false;
  private failure: GovernanceStateError | null = null;

  constructor(input: {
    lease: GovernanceLease;
    policy: GatewayGovernancePolicy;
    repository: GatewayGovernanceRepository;
    requestSignal?: AbortSignal;
  }) {
    this.lease = input.lease;
    this.policy = input.policy;
    this.repository = input.repository;
    this.requestSignal = input.requestSignal;
    this.signal = this.abortController.signal;
    if (this.requestSignal?.aborted) {
      this.onRequestAbort();
    } else {
      this.requestSignal?.addEventListener("abort", this.onRequestAbort, { once: true });
      this.scheduleHeartbeat();
    }
  }

  async reserveQuota(quotaKind: GatewayQuotaKind, units: number): Promise<void> {
    this.throwIfFailed();
    try {
      await this.repository.reserveQuota({
        leaseId: this.lease.id,
        quotaKind,
        units,
        policy: this.policy,
      });
    } catch (error) {
      if (error instanceof GovernanceRejectedError) {
        recordGovernanceRejection(error, this.lease.operation);
        await this.stopHeartbeat();
        throw error;
      }
      const failure = toGovernanceStateError(error);
      recordGovernanceFailure("quota_reserve");
      this.recordFailure(failure);
      throw failure;
    }
  }

  markProviderStarted(): Promise<void> {
    this.throwIfFailed();
    this.providerStartedPromise ??= this.repository.markProviderStarted(this.lease.id)
      .catch((error: unknown) => {
        const failure = toGovernanceStateError(error);
        recordGovernanceFailure("provider_start");
        this.recordFailure(failure);
        throw failure;
      });
    return this.providerStartedPromise;
  }

  finalize(actualUnits?: number): Promise<GovernanceSettlement> {
    this.finalizePromise ??= this.finalizeOnce(actualUnits);
    return this.finalizePromise;
  }

  getFailure(): GovernanceStateError | null {
    return this.failure;
  }

  private async finalizeOnce(actualUnits?: number): Promise<GovernanceSettlement> {
    await this.stopHeartbeat();
    let settlement: GovernanceSettlement;
    try {
      settlement = await this.repository.finalize(this.lease.id, actualUnits);
    } catch (error) {
      const failure = toGovernanceStateError(error);
      recordGovernanceFailure("finalize");
      this.recordFailure(failure);
      throw failure;
    }
    recordGovernanceSettlement(settlement);
    this.throwIfFailed();
    return settlement;
  }

  private scheduleHeartbeat(): void {
    if (this.stopped || this.abortController.signal.aborted) return;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      if (this.stopped) return;
      this.heartbeatInFlight = this.repository.heartbeat(this.lease.id)
        .then(() => undefined)
        .catch((error: unknown) => {
          recordGovernanceFailure("heartbeat");
          this.recordFailure(toGovernanceStateError(error));
        })
        .finally(() => {
          this.heartbeatInFlight = null;
          this.scheduleHeartbeat();
        });
    }, GOVERNANCE_HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private async stopHeartbeat(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.requestSignal?.removeEventListener("abort", this.onRequestAbort);
    await this.heartbeatInFlight;
  }

  private readonly onRequestAbort = (): void => {
    this.stopped = true;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(this.requestSignal?.reason);
    }
  };

  private recordFailure(error: GovernanceStateError): void {
    this.failure ??= error;
    this.stopped = true;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (!this.abortController.signal.aborted) this.abortController.abort(error);
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }
}

export async function runWithGatewayGovernance<T>(
  handle: GatewayGovernanceHandle,
  operation: () => Promise<GatewayGovernanceRunResult<T>>,
): Promise<T> {
  let result: GatewayGovernanceRunResult<T> | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  await handle.finalize(result?.actualUnits);
  if (operationFailed) throw operationError;
  return result!.value;
}

export async function beginGatewayGovernance(
  input: BeginGovernanceInput,
): Promise<GatewayGovernanceHandle> {
  const repository = await resolveGovernanceRepository(input.repository);
  const { policy } = await loadGovernancePolicy(repository);
  await consumeGovernanceRate(repository, input.identity, policy, input.operation);
  return acquireGovernanceLease({ ...input, policy }, repository);
}

export async function acquireGatewayGovernanceLease(
  input: AcquireGovernanceLeaseInput,
): Promise<GatewayGovernanceHandle> {
  const repository = await resolveGovernanceRepository(input.repository);
  return acquireGovernanceLease(input, repository);
}

async function acquireGovernanceLease(
  input: AcquireGovernanceLeaseInput,
  repository: GatewayGovernanceRepository,
): Promise<GatewayGovernanceHandle> {
  let lease: GovernanceLease;
  try {
    lease = await repository.acquireLease({
      identity: input.identity,
      operation: input.operation,
      policy: input.policy,
    });
  } catch (error) {
    if (error instanceof GovernanceRejectedError) {
      recordGovernanceRejection(error, input.operation);
      throw error;
    }
    recordGovernanceFailure("lease");
    throw toGovernanceStateError(error);
  }
  return new GatewayGovernanceHandle({
    lease,
    policy: input.policy,
    repository,
    requestSignal: input.requestSignal,
  });
}

export async function consumeGatewayGovernanceRate(input: {
  identity: GovernanceIdentity;
  operation: GatewayGovernanceMetricOperation;
  repository?: GatewayGovernanceRepository;
}): Promise<GatewayGovernancePolicy> {
  const repository = await resolveGovernanceRepository(input.repository);
  const { policy } = await loadGovernancePolicy(repository);
  await consumeGovernanceRate(repository, input.identity, policy, input.operation);
  return policy;
}

export function startGatewayGovernanceReaper(input: {
  repository: GatewayGovernanceRepository;
  onFailure?: (diagnosticCode: string) => void;
  intervalMs?: number;
  batchSize?: number;
}): GovernanceReaperController {
  const intervalMs = input.intervalMs ?? GOVERNANCE_REAPER_INTERVAL_MS;
  const batchSize = input.batchSize ?? GOVERNANCE_REAPER_BATCH_SIZE;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      inFlight = (async () => {
        try {
          for (let i = 0; i < batchSize; i++) {
            if (!await input.repository.reapExpiredOne()) break;
          }
        } catch (error) {
          recordGovernanceFailure("reaper");
          input.onFailure?.(safeInfrastructureErrorCode(error));
        }
      })().finally(() => {
        inFlight = null;
        schedule();
      });
    }, intervalMs);
    timer.unref?.();
  };

  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
    },
  };
}

/** 仅暴露低敏基础设施错误码，避免 SQL、参数和连接信息进入日志。 */
function safeInfrastructureErrorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const code = "code" in current ? current.code : undefined;
    if (
      typeof code === "string"
      && (/^[A-Z0-9]{5}$/.test(code)
        || ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EPIPE", "ETIMEDOUT"].includes(code))
    ) return code;
    current = "cause" in current ? current.cause : undefined;
  }
  return "unknown";
}

function toGovernanceStateError(error: unknown): GovernanceStateError {
  return error instanceof GovernanceStateError
    ? error
    : new GovernanceStateError("Gateway governance database operation failed");
}

async function resolveGovernanceRepository(
  repository?: GatewayGovernanceRepository,
): Promise<GatewayGovernanceRepository> {
  if (repository) return repository;
  try {
    return await createGatewayGovernanceRepository();
  } catch (error) {
    recordGovernanceFailure("repository");
    throw toGovernanceStateError(error);
  }
}

async function loadGovernancePolicy(
  repository: GatewayGovernanceRepository,
): Promise<Awaited<ReturnType<GatewayGovernanceRepository["loadPolicy"]>>> {
  try {
    const loaded = await repository.loadPolicy();
    if (loaded.source === "invalid") recordGovernanceFailure("policy_invalid");
    return loaded;
  } catch (error) {
    recordGovernanceFailure("policy_load");
    throw toGovernanceStateError(error);
  }
}

async function consumeGovernanceRate(
  repository: GatewayGovernanceRepository,
  identity: GovernanceIdentity,
  policy: GatewayGovernancePolicy,
  operation: GatewayGovernanceMetricOperation,
): Promise<void> {
  try {
    await repository.consumeRate(identity, policy);
  } catch (error) {
    if (error instanceof GovernanceRejectedError) {
      recordGovernanceRejection(error, operation);
      throw error;
    }
    recordGovernanceFailure("rate");
    throw toGovernanceStateError(error);
  }
}

function recordGovernanceRejection(
  error: GovernanceRejectedError,
  operation: GatewayGovernanceMetricOperation,
): void {
  try {
    observeGatewayGovernanceRejection({
      reason: error.reason,
      scope: error.scope,
      operation,
    });
  } catch {
    // Metrics are best-effort and never participate in admission decisions.
  }
}

function recordGovernanceSettlement(settlement: GovernanceSettlement): void {
  if (!settlement.settled || !settlement.quotaKind) return;
  try {
    observeGatewayGovernanceSettlement({
      quotaKind: settlement.quotaKind,
      outcome: settlement.overage ? "overage" : "settled",
    });
  } catch {
    // Metrics are best-effort and never participate in settlement decisions.
  }
}

function recordGovernanceFailure(stage: GatewayGovernanceFailureStage): void {
  try {
    observeGatewayGovernanceFailure(stage);
  } catch {
    // Metrics are best-effort and never participate in governance decisions.
  }
}
