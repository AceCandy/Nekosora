/**
 * 进程内熔断器(Circuit Breaker)—— 按 provider 维度。
 *
 * 状态机:
 *   closed   → 连续失败达 threshold → open
 *   open     → 冷却 cooldownMs 后 → half-open
 *   half-open→ 成功 → closed;失败 → open
 *
 * 目的:某上游 provider 连续失败(如证书过期 / 限流 / 宕机)时,
 * resolveRoutes 自动跳过它,避免反复撞墙;冷却后放一次试探请求恢复。
 *
 * 不持久化、不跨进程(进程内 Map)。多副本部署时各副本独立熔断,
 * 失败信息不共享——这是有意的取舍:零依赖、无 Redis 开销。
 * 若未来需要全集群统一熔断,可替换为 Redis 实现(接口不变)。
 */
import {
  observeGatewayCircuitBreakerEvent,
  type GatewayCircuitBreakerEvent,
} from "@/lib/infra/metrics";
import type {
  GatewayBreakerPermit,
  GatewayBreakerPort,
} from "@/lib/gateway-execution/types";

export type ProviderAvailability = "closed" | "probe_ready" | "open" | "probe_busy";

export type ProviderPermit = GatewayBreakerPermit;

/** 单个熔断器的运行时状态。 */
interface BreakerState {
  /** 当前状态。 */
  status: "closed" | "open" | "half-open";
  /** 连续失败次数，Provider 成功后归零。 */
  failures: number;
  /** 上次失败时间戳(ms)。 */
  lastFailureAt: number;
  /** open 状态下,此时间之前都拒绝(half-open 触发时间)。 */
  openUntil: number;
  /** 当前 half-open 探针的一次性所有权 token。 */
  probeToken?: symbol;
}

/** 熔断器配置(可通过环境变量覆盖)。 */
interface BreakerConfig {
  /** 连续失败多少次后开启熔断。 */
  threshold: number;
  /** 熔断后冷却多久才放行试探(half-open)。 */
  cooldownMs: number;
}

const DEFAULT_CONFIG: BreakerConfig = {
  // 5 次连续失败即熔断——平衡敏感度与误报。
  threshold: Number(process.env.CIRCUIT_BREAKER_THRESHOLD) || 5,
  // 默认 30s 冷却。可在 half-open 阶段试探恢复。
  cooldownMs: Number(process.env.CIRCUIT_BREAKER_COOLDOWN_MS) || 30_000,
};

// 全局熔断器注册表:providerId → state。惰性初始化。
const breakers = new Map<string, BreakerState>();

function getState(id: string): BreakerState {
  let s = breakers.get(id);
  if (!s) {
    s = {
      status: "closed",
      failures: 0,
      lastFailureAt: 0,
      openUntil: 0,
    };
    breakers.set(id, s);
  }
  return s;
}

/** 纯查询 Provider 当前可用性，不占用 half-open 探针。 */
export function getProviderAvailability(providerId: string): ProviderAvailability {
  const s = breakers.get(providerId);
  if (!s || s.status === "closed") return "closed";
  if (s.status === "half-open") return "probe_busy";
  return Date.now() >= s.openUntil ? "probe_ready" : "open";
}

/** 获取覆盖一次有界路由执行的 Provider permit。 */
export function acquireProviderPermit(providerId: string): ProviderPermit | null {
  const availability = getProviderAvailability(providerId);
  if (availability === "open" || availability === "probe_busy") return null;

  const state = getState(providerId);
  const probeToken = availability === "probe_ready" ? Symbol(providerId) : undefined;
  if (probeToken) {
    state.status = "half-open";
    state.probeToken = probeToken;
    recordBreakerEvent("probe_acquired");
  }

  let succeeded = false;
  let failed = false;
  let released = false;
  return {
    recordSuccess() {
      if (!released) succeeded = true;
    },
    recordFailure() {
      if (!released) failed = true;
    },
    release() {
      if (released) return;
      released = true;
      const current = breakers.get(providerId);
      if (!current) return;
      if (probeToken) {
        if (current.status !== "half-open" || current.probeToken !== probeToken) return;
        if (succeeded) {
          recordSuccess(providerId);
          recordBreakerEvent("probe_succeeded");
        } else if (failed) {
          recordFailure(providerId);
          recordBreakerEvent("probe_failed");
        } else {
          current.status = "open";
          current.probeToken = undefined;
        }
        recordBreakerEvent("probe_released");
        return;
      }
      if (current.status === "half-open") return;
      if (succeeded) recordSuccess(providerId);
      else if (failed) recordFailure(providerId);
    },
  };
}

/**
 * 上报一次成功。重置失败计数,回到 closed。
 * 在 half-open 态收到成功意味着 provider 已恢复。
 */
export function recordSuccess(providerId: string): void {
  const s = breakers.get(providerId);
  if (!s) return;
  s.status = "closed";
  s.failures = 0;
  s.openUntil = 0;
  s.probeToken = undefined;
}

/**
 * 上报一次失败。累计计数,达阈值则开启熔断。
 * half-open 态收到失败立即重回 open(并重置冷却计时)。
 */
export function recordFailure(providerId: string): void {
  const cfg = DEFAULT_CONFIG;
  const s = getState(providerId);
  const now = Date.now();
  s.failures += 1;
  s.lastFailureAt = now;

  if (s.status === "half-open") {
    // 试探失败 → 立即重回 open。
    openCircuit(s, now, cfg);
    return;
  }

  if (s.failures >= cfg.threshold) {
    openCircuit(s, now, cfg);
  }
}

/** 将熔断器置为 open 状态。 */
function openCircuit(s: BreakerState, now: number, cfg: BreakerConfig): void {
  s.status = "open";
  s.openUntil = now + cfg.cooldownMs;
  s.probeToken = undefined;
}

export function recordNoHealthyRoute(): void {
  recordBreakerEvent("no_healthy_route");
}

export const gatewayBreaker: GatewayBreakerPort = {
  acquire: acquireProviderPermit,
  recordNoHealthyRoute,
};

function recordBreakerEvent(event: GatewayCircuitBreakerEvent): void {
  try {
    observeGatewayCircuitBreakerEvent(event);
  } catch {
    /* 指标失败不得改变熔断结果。 */
  }
}

/** 诊断:导出所有熔断器当前状态(供 /admin/operations 运维页展示)。 */
export function snapshotBreakers(): Record<
  string,
  {
    status: BreakerState["status"];
    failures: number;
    openUntil: number | null;
    lastFailureAt: number | null;
  }
> {
  const out: Record<string, {
    status: BreakerState["status"];
    failures: number;
    openUntil: number | null;
    lastFailureAt: number | null;
  }> = {};
  for (const [id, s] of breakers) {
    out[id] = {
      status: s.status,
      failures: s.failures,
      openUntil: s.status === "open" ? s.openUntil : null,
      lastFailureAt: s.lastFailureAt || null,
    };
  }
  return out;
}

/** 重置单个 provider 的熔断器(供运维页手动恢复)。 */
export function resetBreaker(providerId: string): void {
  breakers.delete(providerId);
}

/** 重置全部熔断器(供测试 / 运维重置)。 */
export function resetAllBreakers(): void {
  breakers.clear();
}
