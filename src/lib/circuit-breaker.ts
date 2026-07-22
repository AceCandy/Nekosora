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

/** 单个熔断器的运行时状态。 */
interface BreakerState {
  /** 当前状态。 */
  status: "closed" | "open" | "half-open";
  /** 连续失败次数(open 触发后归零)。 */
  failures: number;
  /** 上次失败时间戳(ms)。 */
  lastFailureAt: number;
  /** open 状态下,此时间之前都拒绝(half-open 触发时间)。 */
  openUntil: number;
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

/**
 * 查询某 provider 是否允许通过(即不在 open 态)。
 *
 * 若处于 open 但已过冷却期,自动转为 half-open 并放行(试探请求)。
 * half-open 期间只允许通过一次,结果回报前拒绝其他请求。
 */
export function isProviderAllowed(providerId: string): boolean {
  const s = getState(providerId);
  const now = Date.now();

  if (s.status === "open") {
    if (now >= s.openUntil) {
      // 冷却到期 → half-open,放一次试探。
      s.status = "half-open";
      return true;
    }
    return false; // 仍在熔断期
  }
  // half-open 表示探测名额已占用,结果回报前拒绝其他请求。
  return s.status === "closed";
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
}

/**
 * 批量过滤:给定一组 providerId,返回当前允许通过(非 open)的子集。
 *
 * 供 resolveRoutes 使用:跳过熔断中的 provider 的路由。
 * 注意:若全部被熔断(避免全站不可用),返回原始全集(降级放行),
 * 由调用方逐条尝试——宁可撞墙也不静默拒绝所有请求。
 */
export function filterAllowedOrFallback(providerIds: string[]): string[] {
  const allowed = providerIds.filter((id) => isProviderAllowed(id));
  // 全部被熔断:降级返回全集,避免雪崩式全站 503。
  return allowed.length > 0 ? allowed : providerIds;
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
