/**
 * 上下文压缩服务 —— 长会话的旧消息摘要成 ContextSnapshot,控制 token 增长。
 *
 * 借鉴 DEEIX-Chat:
 *   - 双触发:turn_cap(用户轮次 > N)/ token_cap(估算 token > M)
 *   - 保留最近 preserveRecent 轮原文,其余摘要
 *   - CoveragePathHash 校验快照可复用性(分支安全)
 *   - 4 级回退:LLM full → LLM lite → 模板 → 空
 *   - 熔断器:连续失败自动降级(TS 单线程用普通计数器)
 */
import { eq, and, desc } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { coveragePathHash, type HashableMessage } from "./coverage";
import { estimateMessagesTokens } from "@/lib/tokens";
import { streamChat } from "@/lib/stream";

const DEFAULT_MAX_TURNS = 16;
const DEFAULT_COMPACT_TRIGGER_TOKENS = 12000;
const DEFAULT_PRESERVE_RECENT = 8;
const MAX_COMPACT_FAILURES = 3;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

// 熔断器状态(单线程安全)
let consecutiveFailures = 0;
let lastFailureAt = 0;

function circuitClosed(): boolean {
  if (consecutiveFailures < MAX_COMPACT_FAILURES) return true;
  if (Date.now() - lastFailureAt > FAILURE_COOLDOWN_MS) {
    consecutiveFailures = 0; // 冷却后自动恢复
    return true;
  }
  return false;
}

function recordFailure() {
  consecutiveFailures++;
  lastFailureAt = Date.now();
}

function recordSuccess() {
  consecutiveFailures = 0;
}

export interface CompactionResult {
  /** 是否触发了压缩。 */
  compacted: boolean;
  /** 摘要文本(注入为 system 上下文);未触发则为 null。 */
  summary: string | null;
  /** 策略。 */
  strategy: "turn_cap" | "token_cap" | "none";
  /** 使用的回退级别。 */
  fallbackLevel: "L3" | "L2" | "L1" | "L0" | "none";
}

interface CompactionMessage {
  id: string;
  publicId: string;
  parentId: string | null;
  role: string;
  content: string;
}

/**
 * 判断并执行压缩。返回摘要 + 策略。
 * 幂等:已有匹配 CoveragePathHash 的快照则直接复用。
 */
export async function maybeCompact(
  conversationId: string,
  messages: CompactionMessage[],
): Promise<CompactionResult> {
  const userTurns = messages.filter((m) => m.role === "user").length;

  // 双触发判断
  let trigger: "turn_cap" | "token_cap" | "none" = "none";
  if (userTurns > DEFAULT_MAX_TURNS) trigger = "turn_cap";
  const tokenEst = estimateMessagesTokens(messages.map((m) => ({ role: m.role, content: m.content })));
  if (trigger === "none" && tokenEst > DEFAULT_COMPACT_TRIGGER_TOKENS) trigger = "token_cap";

  if (trigger === "none") {
    return { compacted: false, summary: null, strategy: "none", fallbackLevel: "none" };
  }

  // 1. 查找可复用快照(同会话 + 路径哈希匹配)
  const reusable = await findReusableSnapshot(conversationId, messages);
  if (reusable) {
    return {
      compacted: true,
      summary: reusable,
      strategy: trigger,
      fallbackLevel: "none", // 复用,未重新生成
    };
  }

  // 2. 分割:保留最近 preserveRecent 轮,其余摘要
  const { covered } = splitByPreservedTurns(messages, DEFAULT_PRESERVE_RECENT);
  if (covered.length === 0) {
    return { compacted: false, summary: null, strategy: "none", fallbackLevel: "none" };
  }

  // 3. 4 级回退生成摘要
  const { summary, level } = await buildSummary(covered);
  if (summary) recordSuccess();

  // 4. 持久化快照
  await saveSnapshot(conversationId, covered, summary, trigger);

  return {
    compacted: true,
    summary,
    strategy: trigger,
    fallbackLevel: level,
  };
}

/** 查找可复用快照:CoveragePathHash 匹配当前消息前缀。 */
async function findReusableSnapshot(conversationId: string, messages: CompactionMessage[]): Promise<string | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const coveredCount = messages.length - countRecentTurns(messages, DEFAULT_PRESERVE_RECENT);
  if (coveredCount <= 0) return null;

  const covered = messages.slice(0, coveredCount);
  const hashable: HashableMessage[] = covered.map((m) => ({
    id: m.id, publicId: m.publicId, parentId: m.parentId, role: m.role,
  }));
  const pathHash = coveragePathHash(hashable);

  const [snapshot] = await db
    .select()
    .from(s.contextSnapshots)
    .where(
      and(
        eq(s.contextSnapshots.conversationId, conversationId),
        eq(s.contextSnapshots.coveragePathHash, pathHash),
        eq(s.contextSnapshots.coveredMessageCount, coveredCount),
      ),
    )
    .orderBy(desc(s.contextSnapshots.createdAt))
    .limit(1);

  return snapshot?.summaryText ?? null;
}

/** 按保留轮数分割消息:covered(旧,待摘要) + retained(新,保留原文)。 */
function splitByPreservedTurns(messages: CompactionMessage[], preserveTurns: number): {
  covered: CompactionMessage[];
  retained: CompactionMessage[];
} {
  const recentCount = countRecentTurns(messages, preserveTurns);
  const splitIdx = messages.length - recentCount;
  return {
    covered: messages.slice(0, Math.max(0, splitIdx)),
    retained: messages.slice(Math.max(0, splitIdx)),
  };
}

/** 从末尾向前数,保留 N 个 user 轮对应的消息数。 */
function countRecentTurns(messages: CompactionMessage[], preserveTurns: number): number {
  let turns = 0;
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      turns++;
      if (turns > preserveTurns) break;
    }
    count++;
  }
  return count;
}

/**
 * 4 级回退生成摘要。
 *   L3:LLM 全量(全部 covered 消息)
 *   L2:LLM 精简(后半 covered 消息)
 *   L1:模板(无 LLM)
 *   L0:空(依赖上层截断)
 */
async function buildSummary(covered: CompactionMessage[]): Promise<{ summary: string; level: "L3" | "L2" | "L1" | "L0" }> {
  if (!circuitClosed()) {
    return { summary: "", level: "L0" };
  }

  // L3 / L2:尝试用 LLM 摘要
  const half = Math.floor(covered.length / 2);
  const attempts = [
    { msgs: covered, level: "L3" as const, lite: false },
    { msgs: covered.slice(half), level: "L2" as const, lite: true },
  ];

  for (const attempt of attempts) {
    try {
      const summary = await llmSummarize(attempt.msgs, attempt.lite);
      if (summary) return { summary, level: attempt.level };
    } catch (err) {
      console.warn(`[compact] ${attempt.level} 摘要失败:`, err);
      recordFailure();
      if (!circuitClosed()) break; // 熔断,直接到 L1/L0
    }
  }

  // L1:模板
  return {
    summary: `[上下文摘要不可用,保留最近 ${DEFAULT_PRESERVE_RECENT} 轮原文。已压缩 ${covered.length} 条历史消息。]`,
    level: "L1",
  };
}

/** 用 LLM 生成摘要(复用 streamChat)。失败抛错由上层回退。 */
async function llmSummarize(msgs: CompactionMessage[], lite: boolean): Promise<string> {
  // 取第一个可用的 chat 模型来摘要(简化:用 system 提示让模型总结)
  const { getDb, getSchema } = await import("@/lib/infra/db");
  const { eq, and } = await import("drizzle-orm");
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [model] = await db
    .select()
    .from(s.globalModels)
    .where(and(eq(s.globalModels.accessScope, "internal"), eq(s.globalModels.enabled, true)))
    .limit(1);
  // 没有 internal 模型 → 取第一个 public 模型
  const target = model ?? (await db.select().from(s.globalModels).where(eq(s.globalModels.enabled, true)).limit(1))[0];
  if (!target) throw new Error("无可用模型做摘要");

  const prompt = lite
    ? "请用 200 字以内总结以下对话的关键信息:"
    : "请总结以下对话的要点,保留关键事实、决策和上下文:";

  const dialogue = msgs.map((m) => `${m.role}: ${m.content}`).join("\n");

  // 用 streamChat 聚合全文(非流式消费)
  let result = "";
  const ctx = { userId: "system", keyKind: null as null, source: "chat" as const };
  for await (const ev of streamChat({
    ctx,
    taskKind: "compact",
    request: {
      model: target.name,
      messages: [
        { role: "system", content: "你是一个对话摘要助手。" },
        { role: "user", content: `${prompt}\n\n${dialogue}` },
      ],
      stream: true,
    },
  })) {
    if (ev.type === "text-delta") result += ev.text;
    if (ev.type === "error") throw new Error(ev.error);
  }
  return result.trim();
}

/** 持久化快照到 context_snapshots。 */
async function saveSnapshot(
  conversationId: string,
  covered: CompactionMessage[],
  summary: string,
  strategy: "turn_cap" | "token_cap",
): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const hashable: HashableMessage[] = covered.map((m) => ({
    id: m.id, publicId: m.publicId, parentId: m.parentId, role: m.role,
  }));

  await db.insert(s.contextSnapshots).values({
    conversationId,
    runId: null,
    coveredUntilMessageId: covered[covered.length - 1]?.id ?? null,
    coveredUntilPublicId: covered[covered.length - 1]?.publicId ?? null,
    coveragePathHash: coveragePathHash(hashable),
    coveredMessageCount: covered.length,
    sourceTokens: estimateMessagesTokens(covered.map((m) => ({ role: m.role, content: m.content }))),
    summaryTokens: estimateMessagesTokens([{ role: "system", content: summary }]),
    summaryText: summary,
    strategy,
  });
}
