import type {
  GatewayGovernanceHourlyDelta,
  GatewayGovernanceRepository,
  GovernanceObservation,
  GovernanceRejectedError,
  GovernanceScope,
} from "./repository";

export const GOVERNANCE_AGGREGATE_FLUSH_INTERVAL_MS = 5_000;

export interface GovernanceAggregateController {
  stop(): Promise<void>;
}

interface Recorder {
  request(observation?: GovernanceObservation): void;
  concurrency(observation?: GovernanceObservation): void;
  rejection(error: GovernanceRejectedError, scope: GovernanceScope): void;
}

let currentRecorder: Recorder | null = null;

/** 已鉴权请求在治理准入前调用；聚合失败不得向请求路径抛错。 */
export function recordGatewayGovernanceRequest(observation?: GovernanceObservation): void {
  currentRecorder?.request(observation);
}

export function recordGatewayGovernanceConcurrency(observation?: GovernanceObservation): void {
  currentRecorder?.concurrency(observation);
}

export function recordGatewayGovernanceAggregateRejection(
  error: GovernanceRejectedError,
  scope: GovernanceScope = error.scope,
): void {
  currentRecorder?.rejection(error, scope);
}

/** 进程内双缓冲 recorder；flush 事务失败时把整批合并回 active buffer。 */
export function startGatewayGovernanceAggregate(input: {
  repository: GatewayGovernanceRepository;
  intervalMs?: number;
  onFailure?: () => void;
}): GovernanceAggregateController {
  const intervalMs = input.intervalMs ?? GOVERNANCE_AGGREGATE_FLUSH_INTERVAL_MS;
  let active = new Map<string, GatewayGovernanceHourlyDelta>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const row = (scope: GovernanceScope): GatewayGovernanceHourlyDelta => {
    const bucketStart = utcHour(new Date());
    const key = `${bucketStart.toISOString()}:${scope}`;
    let value = active.get(key);
    if (!value) {
      value = emptyDelta(bucketStart, scope);
      active.set(key, value);
    }
    return value;
  };

  const recorder: Recorder = {
    request(observation) {
      const key = row("key");
      const user = row("user");
      key.requestCount += 1;
      user.requestCount += 1;
      key.rpmPeak = Math.max(key.rpmPeak, observation?.keyRpm ?? 0);
      user.rpmPeak = Math.max(user.rpmPeak, observation?.userRpm ?? 0);
    },
    concurrency(observation) {
      const key = row("key");
      const user = row("user");
      key.concurrencyPeak = Math.max(key.concurrencyPeak, observation?.keyConcurrency ?? 0);
      user.concurrencyPeak = Math.max(user.concurrencyPeak, observation?.userConcurrency ?? 0);
    },
    rejection(error, scope) {
      const value = row(scope);
      if (error.reason === "rate") value.rateRejected += 1;
      else if (error.reason === "concurrency") value.concurrencyRejected += 1;
      else if (error.quotaKind === "chat_tokens") value.quotaChatTokensRejected += 1;
      else if (error.quotaKind === "image_count") value.quotaImageCountRejected += 1;
      else if (error.quotaKind === "tts_code_points") value.quotaTtsCodePointsRejected += 1;
      else if (error.quotaKind === "stt_seconds") value.quotaSttSecondsRejected += 1;
    },
  };
  currentRecorder = recorder;

  const merge = (batch: Map<string, GatewayGovernanceHourlyDelta>) => {
    for (const [key, delta] of batch) {
      const current = active.get(key);
      if (!current) {
        active.set(key, delta);
        continue;
      }
      mergeDelta(current, delta);
    }
  };

  const flush = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (active.size === 0) return Promise.resolve();
    const batch = active;
    active = new Map();
    inFlight = input.repository.upsertHourly([...batch.values()])
      .catch(() => {
        merge(batch);
        input.onFailure?.();
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void flush().finally(schedule);
    }, intervalMs);
    timer.unref?.();
  };
  schedule();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight;
      await flush();
      if (currentRecorder === recorder) currentRecorder = null;
    },
  };
}

function emptyDelta(bucketStart: Date, scope: GovernanceScope): GatewayGovernanceHourlyDelta {
  return {
    bucketStart,
    scope,
    requestCount: 0,
    rpmPeak: 0,
    concurrencyPeak: 0,
    rateRejected: 0,
    concurrencyRejected: 0,
    quotaChatTokensRejected: 0,
    quotaImageCountRejected: 0,
    quotaTtsCodePointsRejected: 0,
    quotaSttSecondsRejected: 0,
  };
}

function mergeDelta(target: GatewayGovernanceHourlyDelta, source: GatewayGovernanceHourlyDelta) {
  target.requestCount += source.requestCount;
  target.rpmPeak = Math.max(target.rpmPeak, source.rpmPeak);
  target.concurrencyPeak = Math.max(target.concurrencyPeak, source.concurrencyPeak);
  target.rateRejected += source.rateRejected;
  target.concurrencyRejected += source.concurrencyRejected;
  target.quotaChatTokensRejected += source.quotaChatTokensRejected;
  target.quotaImageCountRejected += source.quotaImageCountRejected;
  target.quotaTtsCodePointsRejected += source.quotaTtsCodePointsRejected;
  target.quotaSttSecondsRejected += source.quotaSttSecondsRejected;
}

function utcHour(value: Date): Date {
  const bucket = new Date(value);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
}
