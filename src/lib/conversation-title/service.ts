/**
 * 会话标题自动生成 —— 仅在会话首条消息后,把"新会话"替换为简短摘要。
 *
 * 策略:
 *   - 先用首条 user 消息截断生成即时 Fallback 标题(用户立刻可见)
 *   - 再用非流式 generateChat 跑一次轻量生成,产出更准确的摘要
 *   - 两步都通过 onTitle 回调通知调用方(典型:推送 SSE 帧刷新 Sidebar)
 *   - 仅当当前 title 为默认值时触发,避免覆盖用户已改的标题
 *
 * 模型优先级:system_settings(namespace=task, key=title_model) > 对话模型 > gpt-4o-mini
 */
import { eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { generateChat } from "@/lib/stream";
import { getSetting } from "@/lib/system-settings/service";
import type { IRRequest } from "@/lib/providers/types";

const DEFAULT_TITLE = "新会话";
const TITLE_MODEL_FALLBACK = "gpt-4o-mini";
const MAX_TITLE_LEN = 30;
const FALLBACK_MAX_LEN = 16;

/** 标题模型配置缓存(配置变更后由 resetTitleModelConfig 清除)。 */
let _titleModel: string | null | undefined;

/** 读取标题生成模型(带缓存):配置 > 对话模型 > 内置回退。 */
async function resolveTitleModel(chatModel?: string): Promise<string> {
  if (_titleModel === undefined) {
    _titleModel = await getSetting("task", "title_model");
  }
  return _titleModel || chatModel || TITLE_MODEL_FALLBACK;
}

/** 配置变更后清除缓存(admin 保存标题模型配置时调用)。 */
export function resetTitleModelConfig(): void {
  _titleModel = undefined;
}

/**
 * 若会话标题仍为默认值,则生成标题并写库。
 * 每次标题变化(fallback / 最终)通过 onTitle 回调通知调用方。
 * 不抛错(失败时保留 fallback 标题,调用方仍能收到 fallback 的回调)。
 *
 * @param onTitle 每次标题更新时调用(fallback 和最终标题各一次)
 */
export async function maybeGenerateTitle(
  userId: string,
  conversationId: string,
  firstUserMessage: string,
  chatModel?: string,
  onTitle?: (title: string) => void,
): Promise<void> {
  if (!firstUserMessage.trim()) return;

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 仅当标题仍是默认值时触发(尊重用户手动改名)
  const [conv] = await db
    .select({ title: s.conversations.title })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!conv || conv.title !== DEFAULT_TITLE) return;

  // 1. 先写 Fallback 标题(首条消息截断),用户立刻可见,不等 LLM
  const fallback = truncateFallbackTitle(firstUserMessage);
  await db.update(s.conversations).set({ title: fallback }).where(eq(s.conversations.id, conversationId));
  onTitle?.(fallback);

  // 2. 非流式生成更准确的摘要(不思考、不流式,轻量任务)
  const model = await resolveTitleModel(chatModel);
  const prompt = `请把下面这段用户提问概括成一个简短的对话标题(不超过 ${MAX_TITLE_LEN} 字,纯文本,不要引号、不要标点结尾、不要"标题:"前缀):\n\n${firstUserMessage.slice(0, 500)}`;

  const ctx = { userId, keyKind: null as null, source: "chat" as const };
  const request: IRRequest = {
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 64,
  };

  let result;
  try {
    result = await generateChat({ ctx, request, taskKind: "title" });
  } catch {
    return; // 生成失败,保留 fallback
  }
  if (result.error || !result.text) return;

  const title = sanitizeTitle(result.text);
  if (!title) return;

  // 更新前再次校验(并发保护):仍是默认值或仍是本轮 fallback 才更新
  const [recheck] = await db
    .select({ title: s.conversations.title })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!recheck || (recheck.title !== DEFAULT_TITLE && recheck.title !== fallback)) return;

  await db.update(s.conversations).set({ title }).where(eq(s.conversations.id, conversationId));
  onTitle?.(title);
}

/** Fallback 标题:截断首条消息到指定长度,折叠空白。 */
function truncateFallbackTitle(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  // 按字符数截断,超长追加省略号
  if (t.length > FALLBACK_MAX_LEN) {
    return t.slice(0, FALLBACK_MAX_LEN) + "…";
  }
  return t || DEFAULT_TITLE;
}

/** 清洗 LLM 输出为干净标题:去引号/前缀/换行,截断长度。 */
function sanitizeTitle(raw: string): string {
  let t = raw.trim();
  // 去常见包裹引号
  t = t.replace(/^["'“”‘’《「]+|["'“”‘’》」]+$/g, "");
  // 去"标题:"类前缀
  t = t.replace(/^(标题|title)[:：]\s*/i, "");
  // 折叠换行
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > MAX_TITLE_LEN) t = t.slice(0, MAX_TITLE_LEN);
  return t;
}
