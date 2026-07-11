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
import { getSetting } from "@/lib/system-settings/service";

const DEFAULT_MAX_TURNS = 16;
const DEFAULT_COMPACT_TRIGGER_TOKENS = 12000;
const DEFAULT_PRESERVE_RECENT = 8;
const MAX_COMPACT_FAILURES = 3;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
/** 摘要质量兜底:LLM 产出低于此字数视为退化(如「收到✅」),拒绝覆盖旧摘要。 */
const MIN_SUMMARY_CHARS = 200;

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

/** 摘要模型配置缓存(配置变更后由 resetCompactModelConfig 清除)。 */
let _compactModel: string | null | undefined;

/**
 * 读取摘要模型(带缓存):system_settings(task.compact_model) > 第一个 public+enabled 模型名。
 * 配置为空时回退到第一个 public+enabled 模型(design §4.3)。
 */
async function resolveCompactModel(): Promise<string | null> {
  if (_compactModel === undefined) {
    _compactModel = await getSetting("task", "compact_model");
  }
  if (_compactModel) return _compactModel;
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [model] = await db
    .select({ name: s.models.name })
    .from(s.models)
    .where(and(eq(s.models.visibility, "public"), eq(s.models.enabled, true)))
    .limit(1);
  return model?.name ?? null;
}

/** 配置变更后清除缓存(admin 保存摘要模型配置时调用)。 */
export function resetCompactModelConfig(): void {
  _compactModel = undefined;
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

  // 3. 4 级回退生成摘要(链式:传入前一个摘要,LLM 在其基础上合并更新,非从头重摘)
  const previousSummary = await findPreviousSummary(conversationId, covered);
  const { summary, level } = await buildSummary(covered, previousSummary);
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

/**
 * 查找当前 covered 范围的前一个摘要(链式摘要用)。
 * 取本会话最近一条 coveredMessageCount < 当前 covered.length、且 coveredUntilMessageId
 * 落在当前 covered 消息集合内的快照(同分支前缀)。无则 null。
 *
 * 链式锚点:直接读 context_snapshots.summaryText 原文,不从注入消息里抽取,
 * 避免 kivio 式格式漂移导致链式退化为只摘本轮、跨轮丢上下文。
 */
async function findPreviousSummary(conversationId: string, covered: CompactionMessage[]): Promise<string | null> {
  if (covered.length === 0) return null;
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const coveredIds = new Set(covered.map((m) => m.id));
  const rows = await db
    .select({
      summaryText: s.contextSnapshots.summaryText,
      coveredUntilMessageId: s.contextSnapshots.coveredUntilMessageId,
      coveredMessageCount: s.contextSnapshots.coveredMessageCount,
    })
    .from(s.contextSnapshots)
    .where(eq(s.contextSnapshots.conversationId, conversationId))
    .orderBy(desc(s.contextSnapshots.coveredMessageCount), desc(s.contextSnapshots.createdAt));
  for (const r of rows) {
    if (
      r.coveredMessageCount < covered.length &&
      r.coveredUntilMessageId &&
      coveredIds.has(r.coveredUntilMessageId)
    ) {
      return r.summaryText;
    }
  }
  return null;
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
 * 4 级回退生成摘要(链式:传入 previousSummary 让 LLM 在其基础上合并更新)。
 *   L3:LLM 全量(全部 covered 消息)
 *   L2:LLM 精简(后半 covered 消息)
 *   L1:有旧摘要保留原文(防短摘要覆盖),否则模板(无 LLM)
 *   L0:空(依赖上层截断)
 *
 * 质量兜底:LLM 产出 < MIN_SUMMARY_CHARS 视为退化,拒绝覆盖,降级到下一级(design §4.2)。
 */
async function buildSummary(
  covered: CompactionMessage[],
  previousSummary: string | null,
): Promise<{ summary: string; level: "L3" | "L2" | "L1" | "L0" }> {
  if (!circuitClosed()) {
    return { summary: previousSummary ?? "", level: "L0" };
  }

  // L3 / L2:尝试用 LLM 摘要
  const half = Math.floor(covered.length / 2);
  const attempts = [
    { msgs: covered, level: "L3" as const, lite: false },
    { msgs: covered.slice(half), level: "L2" as const, lite: true },
  ];

  for (const attempt of attempts) {
    try {
      const summary = await llmSummarize(attempt.msgs, attempt.lite, previousSummary);
      // 质量兜底:拒绝过短摘要(防"收到✅"式短摘要污染),降级到下一级
      if (summary.length >= MIN_SUMMARY_CHARS) {
        return { summary, level: attempt.level };
      }
      console.warn(`[compact] ${attempt.level} 摘要过短(${summary.length} < ${MIN_SUMMARY_CHARS}),降级`);
    } catch (err) {
      console.warn(`[compact] ${attempt.level} 摘要失败:`, err);
      recordFailure();
      if (!circuitClosed()) break; // 熔断,直接到 L1/L0
    }
  }

  // L1:有旧摘要保留原文(防短摘要覆盖好摘要),否则模板
  if (previousSummary) {
    return { summary: previousSummary, level: "L1" };
  }
  return {
    summary: `[上下文摘要不可用,保留最近 ${DEFAULT_PRESERVE_RECENT} 轮原文。已压缩 ${covered.length} 条历史消息。]`,
    level: "L1",
  };
}

/** 用 LLM 生成摘要(复用 streamChat)。失败抛错由上层回退。 */
async function llmSummarize(
  msgs: CompactionMessage[],
  lite: boolean,
  previousSummary: string | null,
): Promise<string> {
  // 摘要模型可配:system_settings(task.compact_model) > 第一个 public+enabled(design §4.3)
  const target = await resolveCompactModel();
  if (!target) throw new Error("无可用模型做摘要");

  const dialogue = msgs.map((m) => `${m.role}: ${m.content}`).join("\n");
  const prompt = buildSummaryPrompt(dialogue, lite, previousSummary);

  // 用 streamChat 聚合全文(非流式消费)
  let result = "";
  const ctx = { userId: "system", keyKind: null as null, source: "chat" as const };
  for await (const ev of streamChat({
    ctx,
    taskKind: "compact",
    request: {
      model: target,
      messages: [
        { role: "system", content: "你是一个对话摘要助手。" },
        { role: "user", content: prompt },
      ],
      stream: true,
    },
  })) {
    if (ev.type === "text-delta") result += ev.text;
    if (ev.type === "error") throw new Error(ev.error);
  }
  return result.trim();
}

/** 构造摘要 prompt。有 previousSummary 时走链式合并(在其基础上更新,非从头重摘)。 */
function buildSummaryPrompt(dialogue: string, lite: boolean, previousSummary: string | null): string {
  const lead = lite
    ? "请简要总结以下对话的关键信息(保留关键事实与决策):"
    : "请总结以下对话的要点,保留关键事实、决策和上下文:";
  if (previousSummary) {
    return `${lead}

[先前对话摘要]
${previousSummary}

以下是需要合并进来的新对话内容:
${dialogue}

请在先前摘要的基础上,合并新对话内容,更新为一份完整的对话摘要。不要丢失先前摘要中的关键信息。`;
  }
  return `${lead}

${dialogue}`;
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
