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

  const systemMsgs = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  const recent = nonSystem.slice(-preserveRecent);
  const candidates = nonSystem.slice(0, -preserveRecent);

  // 从最近向前累加,直到超预算
  const kept: typeof messages = [...systemMsgs];
  let budget = maxTokens - estimateMessagesTokens(systemMsgs) - estimateMessagesTokens(recent);
  if (budget <= 0) return [...systemMsgs, ...recent];

  // 倒序加入候选(优先保留较新的)
  for (let i = candidates.length - 1; i >= 0; i--) {
    const cost = estimateMessagesTokens([candidates[i]]);
    if (cost > budget) break;
    budget -= cost;
    kept.unshift(candidates[i]); // 插到 system 之后、recent 之前
  }
  kept.push(...recent);
  return kept;
}
