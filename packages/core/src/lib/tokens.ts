/**
 * CJK 感知的轻量 token 估算(借鉴 DEEIX-Chat,省去 tiktoken 依赖)。
 *
 * 规则:
 *   - CJK 字符(中日韩):ceil(cjk_count * 2 / 3)
 *   - 其他字符(英文/符号):ceil(other_count / 4)
 *   - 图片:固定 255 token
 *
 * 精度足够用于"上下文窗口裁剪"这类预算门控;真实用量以 provider 返回为准。
 */

const CJK_RANGES = [
  [0x4e00, 0x9fff], // CJK 统一表意
  [0x3040, 0x30ff], // 平假名 + 片假名
  [0xac00, 0xd7af], // 韩文音节
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0xff00, 0xffef], // 全角字符
];

function isCJK(code: number): boolean {
  return CJK_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/** 估算字符串的 token 数。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isCJK(ch.codePointAt(0) ?? 0)) cjk++;
    else other++;
  }
  return Math.ceil((cjk * 2) / 3) + Math.ceil(other / 4);
}

/** 估算消息列表(OpenAI 格式)的总 token 数。 */
export function estimateMessagesTokens(
  messages: { role: string; content: string | unknown[] }[],
): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        const p = part as { type?: string; text?: string };
        if (p?.type === "image_url") total += 255;
        else if (p?.text) total += estimateTokens(p.text);
      }
    }
    total += 4; // role + 结构开销
  }
  return total;
}

/**
 * 上下文窗口裁剪:从最新消息向前保留,超出预算时丢弃最早的。
 * 始终保留 system 消息(如有)和最近 preserveRecent 条。
 *
 * @returns 裁剪后的消息列表(顺序保持)。
 */
export function trimToTokenBudget(
  messages: { role: string; content: string | unknown[] }[],
  maxTokens: number,
  preserveRecent = 8,
): { role: string; content: string | unknown[] }[] {
  if (messages.length === 0) return messages;
  if (maxTokens <= 0) return [];

  if (estimateMessagesTokens(messages) <= maxTokens) return messages;

  const systemMsgs = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  if (nonSystem.length === 0) return fitMessagesToBudget(systemMsgs, maxTokens);

  const recentCount = Math.max(1, preserveRecent);
  let recent = nonSystem.slice(-recentCount);
  let keptSystem = systemMsgs;

  // 先牺牲较旧的“最近消息”,再压缩 system,最后才压缩最新消息。
  while (
    recent.length > 1
    && estimateMessagesTokens([...keptSystem, ...recent]) > maxTokens
  ) {
    recent = recent.slice(1);
  }

  if (estimateMessagesTokens([...keptSystem, ...recent]) > maxTokens) {
    const latestCost = estimateMessagesTokens([recent[recent.length - 1]]);
    keptSystem = fitMessagesToBudget(systemMsgs, Math.max(0, maxTokens - latestCost));
  }

  if (estimateMessagesTokens([...keptSystem, ...recent]) > maxTokens) {
    const latest = trimMessageToBudget(
      recent[recent.length - 1],
      maxTokens - estimateMessagesTokens(keptSystem),
    );
    recent = latest ? [latest] : [];
  }

  const candidates = nonSystem.slice(0, nonSystem.length - recent.length);
  let budget = maxTokens - estimateMessagesTokens([...keptSystem, ...recent]);

  const keptMiddle: typeof messages = [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const cost = estimateMessagesTokens([candidates[i]]);
    if (cost > budget) continue;
    budget -= cost;
    keptMiddle.unshift(candidates[i]);
  }
  return [...keptSystem, ...keptMiddle, ...recent];
}

type BudgetMessage = { role: string; content: string | unknown[] };

function fitMessagesToBudget(messages: BudgetMessage[], maxTokens: number): BudgetMessage[] {
  const kept: BudgetMessage[] = [];
  let budget = maxTokens;
  for (const message of messages) {
    const cost = estimateMessagesTokens([message]);
    if (cost <= budget) {
      kept.push(message);
      budget -= cost;
      continue;
    }
    const trimmed = trimMessageToBudget(message, budget);
    if (trimmed) kept.push(trimmed);
    break;
  }
  return kept;
}

function trimMessageToBudget(message: BudgetMessage, maxTokens: number): BudgetMessage | null {
  const contentBudget = maxTokens - 4;
  if (contentBudget < 0) return null;
  if (typeof message.content === "string") {
    return { ...message, content: trimTextToBudget(message.content, contentBudget) };
  }

  const parts = message.content;
  const keptImages = new Set<number>();
  let remaining = contentBudget;
  for (let i = 0; i < parts.length && remaining >= 255; i++) {
    if ((parts[i] as { type?: string } | null)?.type === "image_url") {
      keptImages.add(i);
      remaining -= 255;
    }
  }

  const content = parts.flatMap((part, index) => {
    const typed = part as { type?: string; text?: string } | null;
    if (typed?.type === "image_url") return keptImages.has(index) ? [part] : [];
    if (typed?.type !== "text") return [part];
    const text = trimTextToBudget(typed.text ?? "", remaining);
    remaining -= estimateTokens(text);
    return text ? [{ ...typed, text }] : [];
  });

  return { ...message, content };
}

function trimTextToBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || !text) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(chars.slice(0, mid).join("")) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join("");
}
