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
 * 预算控制:system slots 必留,其余按剩余预算填充。
 */
import type { CompactionResult } from "@/lib/compact/service";
import type { UserMemory } from "@/lib/memory/service";
import { buildPreferencePrompt, buildProfilePrompt, buildProjectPrompt } from "@/lib/memory/service";

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
  /** token 预算上限。 */
  maxTokens: number;
}

/**
 * 组装最终消息:在原 messages 前插入一个聚合的 system 消息。
 * 保留原 messages 不变(仅可能增强首个 system)。
 */
export function assembleContext(input: AssembleInput): { role: string; content: string | unknown[] }[] {
  const slots: string[] = [];

  // Slot 1:已有 system(模型/会话级)
  const existing = input.messages;
  const firstSystem = existing.find((m) => m.role === "system");
  if (firstSystem && typeof firstSystem.content === "string") {
    slots.push(firstSystem.content);
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

  // 组装:合并所有非空 slot 为一个 system 消息,替换/前置
  const assembledSystem = slots.filter(Boolean).join("\n\n---\n\n");
  if (!assembledSystem) return input.messages;

  // 移除原首个 system,插入聚合 system
  const rest = firstSystem ? existing.slice(existing.indexOf(firstSystem) + 1) : existing;
  return [{ role: "system", content: assembledSystem }, ...rest];
}
