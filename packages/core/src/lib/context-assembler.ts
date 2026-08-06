/**
 * 槽位式 ContextAssembler —— 把多种上下文来源按优先级 + token 预算组装成最终消息。
 *
 * 借鉴 DEEIX-Chat 的 Slot 抽象:
 *   SlotSystemPrompt   常驻(模型默认 system + 会话级 system)
 *   SlotPreference     用户偏好记忆(cap 400 字)
 *   SlotProfile        用户画像/自定义记忆(top 5)
 *   SlotCompaction     压缩摘要(长会话)
 *   SlotFileContext    RAG 检索的文件片段
 *
 * 预算控制:
 *   - system slots 必留(聚合为一条 system)
 *   - 压缩摘要存在时,丢弃被覆盖的旧历史,仅保留最近 preserveRecent 轮
 *   - 对话消息超出 maxTokens(输入预算)时,复用 trimToTokenBudget 从旧到新裁剪
 */
import {
  DEFAULT_PRESERVE_RECENT,
  retainRecentTurns,
  type CompactionResult,
} from "@/lib/compact/service";
import type { UserMemory } from "@/lib/memory/service";
import { buildPreferencePrompt, buildProfilePrompt, buildProjectPrompt } from "@/lib/memory/service";
import { estimateMessagesTokens, trimToTokenBudget } from "@/lib/tokens";

/** 预算裁剪时强制保留的最近非 system 消息条数(与 tokens.trimToTokenBudget 默认一致)。 */
const DEFAULT_PRESERVE_RECENT_MESSAGES = 8;

export interface AssembleInput {
  /** 用户原始消息(含历史)。 */
  messages: { role: string; content: string | unknown[] }[];
  /** 用户长期记忆(preference + profile 恒定注入)。 */
  memories: UserMemory[];
  /** 召回的 project 记忆(语义/关键词召回,独立 slot)。 */
  recalledMemories?: UserMemory[];
  /** 压缩结果(可能 null)。 */
  compaction: CompactionResult | null;
  /** 文件上下文(RAG 注入的 system 块,可能已含在前置 system)。 */
  fileContext: string | null;
  /** P2-B:模板 system prompt(覆盖模型默认 system)。 */
  templateSystemPrompt?: string | null;
  /**
   * 输入 token 预算上限(已为输出预留后的可用窗口,不是 max_output_tokens)。
   * ≤0 时跳过预算裁剪。
   */
  maxTokens: number;
  /** 预算裁剪时保留的最近非 system 消息数;默认 8。 */
  preserveRecent?: number;
  /** 压缩后保留的最近 user 轮数;默认与 compact.DEFAULT_PRESERVE_RECENT 一致。 */
  preserveRecentTurns?: number;
}

/**
 * 组装最终消息:在原 messages 前插入一个聚合的 system 消息。
 * - 压缩摘要存在时丢弃被覆盖的旧历史
 * - 超输入预算时裁剪中间历史,始终保留 system + 最近消息
 */
export function assembleContext(input: AssembleInput): { role: string; content: string | unknown[] }[] {
  const preserveRecent = input.preserveRecent ?? DEFAULT_PRESERVE_RECENT_MESSAGES;
  const preserveRecentTurns = input.preserveRecentTurns ?? DEFAULT_PRESERVE_RECENT;
  const slots: string[] = [];

  // Slot 1:已有 system(模型/会话级)
  const existing = input.messages;
  const leadingSystem = existing[0]?.role === "system" ? existing[0] : undefined;
  const mergeableSystem = leadingSystem && typeof leadingSystem.content === "string"
    ? leadingSystem
    : undefined;
  const preservedSystem = leadingSystem && !mergeableSystem ? leadingSystem : undefined;
  if (mergeableSystem) {
    slots.push(mergeableSystem.content as string);
  }

  // Slot 1.5:P2-B 模板 system(用户选定的 prompt 模板,覆盖/增强模型默认)。
  if (input.templateSystemPrompt) {
    slots.push(input.templateSystemPrompt);
  }

  // Slot 2:文件上下文(RAG)
  if (input.fileContext) {
    slots.push(input.fileContext);
  }

  // Slot 3:压缩摘要
  if (input.compaction?.summary) {
    slots.push(`[先前对话摘要]\n${input.compaction.summary}`);
  }

  // Slot 4:用户偏好
  const pref = buildPreferencePrompt(input.memories);
  if (pref) {
    slots.push(`[用户偏好]\n${pref}`);
  }

  // Slot 5:用户画像(恒定注入)
  const profile = buildProfilePrompt(input.memories);
  if (profile) {
    slots.push(`[用户画像]\n${profile}`);
  }

  // Slot 6:project 记忆(召回注入,与当前 query 相关的正在进行的事)
  const project = buildProjectPrompt(input.recalledMemories ?? []);
  if (project) {
    slots.push(`[相关记忆]\n${project}`);
  }

  // 对话消息:去掉已并入 slot 的首个 system;压缩后丢弃被摘要覆盖的旧历史
  let dialogue = leadingSystem
    ? existing.slice(1)
    : existing;
  if (input.compaction?.summary) {
    dialogue = retainRecentTurns(dialogue, preserveRecentTurns);
  }

  // 组装:合并所有非空 slot 为一个 system 消息,替换/前置
  const assembledSystem = slots.filter(Boolean).join("\n\n---\n\n");
  let result: { role: string; content: string | unknown[] }[];
  if (!assembledSystem && !preservedSystem) {
    // 无 slot:dialogue 在未裁剪时与 existing 同引用,保持 toBe 兼容
    result = dialogue;
  } else {
    result = [
      ...(preservedSystem ? [preservedSystem] : []),
      ...(assembledSystem ? [{ role: "system", content: assembledSystem }] : []),
      ...dialogue,
    ];
  }

  return applyInputTokenBudget(result, input.maxTokens, preserveRecent);
}

/** 仅在超出输入预算时裁剪;预算内返回原数组引用。 */
function applyInputTokenBudget(
  messages: { role: string; content: string | unknown[] }[],
  maxTokens: number,
  preserveRecent: number,
): { role: string; content: string | unknown[] }[] {
  if (maxTokens <= 0 || messages.length === 0) return messages;
  if (estimateMessagesTokens(messages) <= maxTokens) return messages;
  return trimToTokenBudget(messages, maxTokens, preserveRecent);
}
