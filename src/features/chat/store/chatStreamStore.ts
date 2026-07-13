"use client";

import { create } from "zustand";
import { createConversation, type CreateConversationOptions } from "@/features/chat/actions/conversations";
import { retryFromMessage, editMessage, getMessageSiblings, softDeleteMessage, continueMessage } from "@/features/chat/actions/branch";
import { consumeChatSSE, handleStreamError } from "@/features/chat/model/sse";
import type { ChatMessage, ToolCallRecord } from "@/features/chat/model/types";
import type { ReasoningLevel } from "@/db/types";

/** 新会话(尚无会话 id)在 store 内使用的隔离键。 */
export const NEW_CONVERSATION_KEY = "__new__";

/** 从首条用户消息派生乐观标题(≤16 字符);后台真实标题写入后由 SSR 覆盖。 */
function titleFrom(text: string): string {
  const v = text.trim().replace(/\s+/g, " ").replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, "");
  if (!v) return "";
  return Array.from(v).slice(0, 16).join("");
}

/** 单个会话的运行时状态(消息列表 + 流式标记 + 中断控制器)。 */
interface ConversationRuntime {
  messages: ChatMessage[];
  streaming: boolean;
  abortController: AbortController | null;
}

export interface SendOptions {
  /** 对外模型名(子任务/用量日志/会话持久化沿用 name)。 */
  model: string;
  /** 模型 id(WebChat 发消息走 resolveRoutesById,避免 public/private 同名歧义)。 */
  modelId: string;
  instructionCardIds?: string[];
  webSearch?: boolean;
  knowledgeBaseIds?: string[];
  createOptions?: { outputModeId?: string | null; renderStyleId?: string | null; reasoning?: ReasoningLevel };
}

interface ChatStreamState {
  /** 按 conversationId(或 NEW_CONVERSATION_KEY)隔离的会话运行时。 */
  runtimes: Record<string, ConversationRuntime>;

  /** 当前活跃会话 id(建会写入;Sidebar 高亮用,替代 usePathname 以支持 replaceState 后即时跟随)。 */
  activeConversationId: string | null;
  /** 建会乐观会话项(临时标题);Sidebar 合并显示,SSR 带真实数据后清。 */
  optimisticConversation: { id: string; title: string; createdAt: number } | null;

  /** 注入 SSR 初始消息(仅当 store 内尚无该会话数据时)。 */
  hydrate: (key: string, messages: ChatMessage[]) => void;
  /** 清除某会话的运行时数据。 */
  clear: (key: string) => void;
  /** 将新会话临时数据迁移到真实会话 key 下。 */
  migrate: (fromKey: string, toKey: string) => void;

  send: (
    key: string,
    text: string,
    opts: SendOptions,
    hooks?: {
      uploadAttachments?: (convId: string) => Promise<string[]>;
      onUserMessagePublicId?: (publicId: string) => void;
      onTitleUpdated?: () => void;
      onConversationCreated?: (newConvId: string) => void;
    },
  ) => Promise<void>;
  regenerate: (key: string, assistantPublicId: string, model: string, modelId: string) => Promise<void>;
  editAndResend: (key: string, userPublicId: string, newContent: string, model: string, modelId: string) => Promise<void>;
  deleteMessage: (key: string, publicId: string) => Promise<void>;
  continueGeneration: (key: string, assistantPublicId: string, model: string, modelId: string) => Promise<void>;
  switchVersion: (key: string, publicId: string, direction: "prev" | "next") => Promise<void>;
  refreshVersionInfo: (key: string, publicId: string) => Promise<void>;
  stopGeneration: (key: string) => void;
}

/** 读取某会话运行时,不存在则返回空壳(避免 undefined)。 */
function getRuntime(state: ChatStreamState, key: string): ConversationRuntime {
  return state.runtimes[key] ?? { messages: [], streaming: false, abortController: null };
}

/** 不可变更新某会话运行时。 */
function patchRuntime(
  state: ChatStreamState,
  key: string,
  patch: (rt: ConversationRuntime) => ConversationRuntime,
): Partial<ChatStreamState> {
  const current = getRuntime(state, key);
  return { runtimes: { ...state.runtimes, [key]: patch(current) } };
}

export const useChatStreamStore = create<ChatStreamState>((set, get) => ({
  runtimes: {},
  activeConversationId: null,
  optimisticConversation: null,

  hydrate: (key, messages) => {
    if (get().runtimes[key]) return;
    set((s) => patchRuntime(s, key, () => ({ messages, streaming: false, abortController: null })));
    // 真实会话 SSR hydrate 时清掉同 id 的乐观项(SSR 已带真实数据,避免侧栏重复)
    if (key !== NEW_CONVERSATION_KEY && get().optimisticConversation?.id === key) {
      set({ optimisticConversation: null });
    }
  },

  clear: (key) => {
    set((s) => {
      const next = { ...s.runtimes };
      delete next[key];
      return { runtimes: next };
    });
  },

  migrate: (fromKey, toKey) => {
    set((s) => {
      const from = s.runtimes[fromKey];
      if (!from) return s;
      const next = { ...s.runtimes };
      delete next[fromKey];
      next[toKey] = from;
      return { runtimes: next };
    });
  },

  send: async (key, text, opts, hooks) => {
    const rt = getRuntime(get(), key);
    if (!text.trim() || !opts.model || rt.streaming) return;

    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const userMsgIdx = rt.messages.length;
    const nextMessages = [...rt.messages, userMsg];
    set((s) => patchRuntime(s, key, (r) => ({ ...r, messages: nextMessages, streaming: true })));

    const controller = new AbortController();
    set((s) => patchRuntime(s, key, (r) => ({ ...r, abortController: controller })));

    // 从已迁移后的运行时中读取真实会话 id(若存在)
    const convId = key === NEW_CONVERSATION_KEY ? null : key;
    let newConvId: string | null = null;

    // 局部消息更新闭包,绑定到动态键(新建会话时键会迁移,SSE 期间统一用真实会话 id)
    const appendToMessageAt = (k: string, idx: number, t: string) =>
      set((s) => patchRuntime(s, k, (r) => {
        if (idx < 0 || idx >= r.messages.length) return r;
        const copy = [...r.messages];
        copy[idx] = { ...copy[idx], content: (copy[idx].content ?? "") + t };
        return { ...r, messages: copy };
      }));
    const appendReasoningAt = (k: string, idx: number, t: string) =>
      set((s) => patchRuntime(s, k, (r) => {
        if (idx < 0 || idx >= r.messages.length) return r;
        const copy = [...r.messages];
        copy[idx] = { ...copy[idx], reasoning: (copy[idx].reasoning ?? "") + t };
        return { ...r, messages: copy };
      }));
    const setMessageContentAt = (k: string, idx: number, content: string) =>
      set((s) => patchRuntime(s, k, (r) => {
        if (idx < 0 || idx >= r.messages.length) return r;
        const copy = [...r.messages];
        copy[idx] = { ...copy[idx], content };
        return { ...r, messages: copy };
      }));
    const mergeTraceAt = (k: string, idx: number, trace: ChatMessage["trace"]) =>
      set((s) => patchRuntime(s, k, (r) => {
        if (idx < 0 || idx >= r.messages.length) return r;
        const copy = [...r.messages];
        copy[idx] = { ...copy[idx], trace };
        return { ...r, messages: copy };
      }));
    const setSearchResultsAt = (k: string, idx: number, results: ChatMessage["searchResults"]) =>
      set((s) => patchRuntime(s, k, (r) => {
        if (idx < 0 || idx >= r.messages.length) return r;
        const copy = [...r.messages];
        copy[idx] = { ...copy[idx], searchResults: results };
        return { ...r, messages: copy };
      }));
    const addToolCallAt = (k: string, idx: number, rec: ToolCallRecord) =>
      set((s) => patchRuntime(s, k, (r) => {
        if (idx < 0 || idx >= r.messages.length) return r;
        const copy = [...r.messages];
        copy[idx] = { ...copy[idx], toolCalls: [...(copy[idx].toolCalls ?? []), rec] };
        return { ...r, messages: copy };
      }));
    const finishToolCallAt = (k: string, idx: number, toolName: string, isError: boolean) =>
      set((s) => patchRuntime(s, k, (r) => {
        if (idx < 0 || idx >= r.messages.length) return r;
        const copy = [...r.messages];
        const calls = [...(copy[idx].toolCalls ?? [])];
        for (let i = calls.length - 1; i >= 0; i--) {
          if (calls[i].toolName === toolName && calls[i].status === "calling") {
            calls[i] = { ...calls[i], status: isError ? "error" : "done" };
            break;
          }
        }
        copy[idx] = { ...copy[idx], toolCalls: calls };
        return { ...r, messages: copy };
      }));

    try {
      let resolvedConvId = convId;
      if (!resolvedConvId) {
        const createOpts: CreateConversationOptions = {
          outputModeId: opts.createOptions?.outputModeId,
          renderStyleId: opts.createOptions?.renderStyleId,
          webSearch: opts.webSearch,
          cardIds: opts.instructionCardIds,
          kbIds: opts.knowledgeBaseIds,
          reasoningByModelId: opts.createOptions?.reasoning
            ? { [opts.modelId]: opts.createOptions.reasoning }
            : undefined,
        };
        resolvedConvId = await createConversation(opts.model, createOpts);
        newConvId = resolvedConvId;
        // 记录活跃会话 + 乐观会话项(供 Sidebar 立即高亮/插入);新会话场景不走 router.refresh
        set({
          activeConversationId: resolvedConvId,
          optimisticConversation: { id: resolvedConvId, title: titleFrom(text), createdAt: Date.now() },
        });
        // 将新会话数据从临时键迁移到真实会话 id 键下,后续写操作以新键为准
        get().migrate(NEW_CONVERSATION_KEY, resolvedConvId);
        // 立即切路由:使组件 key 由临时键切到真实会话 id,从而订阅到迁移后的消息。
        // 若延迟到 finally,流式期间组件仍订阅已被 migrate 清空的临时键,看不到生成内容。
        hooks?.onConversationCreated?.(resolvedConvId);
      }

      const fileIds = hooks?.uploadAttachments ? await hooks.uploadAttachments(resolvedConvId) : [];

      const assistantIdx = (() => {
        let idx = -1;
        set((s) => patchRuntime(s, resolvedConvId!, (r) => {
          idx = r.messages.length;
          return { ...r, messages: [...r.messages, { role: "assistant", content: "" }] };
        }));
        return idx;
      })();

      // 取上一轮 assistant 的 publicId 作为 parentPublicId,使后端能把本轮 user 正确挂到主线上。
      // 缺失会导致 parentId 断链,刷新后 getVisibleBranch 回溯主线时前面历史会被丢弃。
      const parentPublicId = (() => {
        for (let i = rt.messages.length - 1; i >= 0; i--) {
          if (rt.messages[i].role === "assistant") return rt.messages[i].publicId;
        }
        return undefined;
      })();

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: resolvedConvId,
          model: opts.model,
          modelId: opts.modelId,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          fileIds,
          parentPublicId,
          ...(opts.instructionCardIds && opts.instructionCardIds.length > 0 ? { instructionCardIds: opts.instructionCardIds } : {}),
          ...(opts.webSearch ? { webSearch: true } : {}),
          ...(opts.knowledgeBaseIds && opts.knowledgeBaseIds.length > 0 ? { knowledgeBaseIds: opts.knowledgeBaseIds } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("请求失败");

      const activeKey = resolvedConvId!;
      await consumeChatSSE(res.body, {
        onDelta: (t) => appendToMessageAt(activeKey, assistantIdx, t),
        onReasoning: (t) => appendReasoningAt(activeKey, assistantIdx, t),
        onToolCall: (name, args) => addToolCallAt(activeKey, assistantIdx, { toolName: name, args, status: "calling" }),
        onToolResult: (name, isError) => finishToolCallAt(activeKey, assistantIdx, name, isError),
        onSearchResult: (results) => setSearchResultsAt(activeKey, assistantIdx, results),
        onError: (err) => setMessageContentAt(activeKey, assistantIdx, `[错误] ${err}`),
        onTrace: (trace) => mergeTraceAt(activeKey, assistantIdx, trace),
        onUserMessage: (publicId) => {
          set((s) => patchRuntime(s, activeKey, (r) => {
            if (userMsgIdx >= r.messages.length) return r;
            if (r.messages[userMsgIdx].role !== "user") return r;
            if (r.messages[userMsgIdx].publicId) return r;
            const updated = [...r.messages];
            updated[userMsgIdx] = { ...updated[userMsgIdx], publicId };
            return { ...r, messages: updated };
          }));
          hooks?.onUserMessagePublicId?.(publicId);
        },
        onAssistantMessage: (publicId) => {
          // 回填 assistant 占位的 publicId,使生成期间即可显示操作按钮(无需刷新)
          set((s) => patchRuntime(s, activeKey, (r) => {
            if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
            if (r.messages[assistantIdx].publicId) return r;
            const updated = [...r.messages];
            updated[assistantIdx] = { ...updated[assistantIdx], publicId };
            return { ...r, messages: updated };
          }));
        },
        onTitleUpdated: () => hooks?.onTitleUpdated?.(),
      });
    } catch (err) {
      const activeKey = convId ?? newConvId ?? NEW_CONVERSATION_KEY;
      const lastIdx = (() => {
        let idx = -1;
        set((s) => patchRuntime(s, activeKey, (r) => {
          idx = r.messages.length - 1;
          return r;
        }));
        return idx;
      })();
      const { content } = handleStreamError(err, "网络错误");
      if (lastIdx >= 0) {
        const k = activeKey;
        set((s) => patchRuntime(s, k, (r) => {
          if (lastIdx >= r.messages.length) return r;
          const copy = [...r.messages];
          copy[lastIdx] = { ...copy[lastIdx], content: (copy[lastIdx].content ?? "") + content };
          return { ...r, messages: copy };
        }));
      }
    } finally {
      const finalKey = convId ?? newConvId ?? NEW_CONVERSATION_KEY;
      set((s) => patchRuntime(s, finalKey, (r) => ({ ...r, streaming: false, abortController: null })));
    }
  },

  regenerate: async (key, assistantPublicId, model, modelId) => {
    const rt = getRuntime(get(), key);
    if (key === NEW_CONVERSATION_KEY || rt.streaming || !assistantPublicId) return;
    set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: true })));
    const controller = new AbortController();
    set((s) => patchRuntime(s, key, (r) => ({ ...r, abortController: controller })));

    try {
      const result = await retryFromMessage(key, assistantPublicId);
      const assistantIdx = (() => {
        let idx = -1;
        set((s) => patchRuntime(s, key, (r) => {
          idx = r.messages.findIndex((x) => x.publicId === assistantPublicId);
          if (idx < 0) return r;
          const replaced: ChatMessage = { role: "assistant", content: "", publicId: result.newAssistantPublicId };
          return { ...r, messages: [...r.messages.slice(0, idx), replaced] };
        }));
        return idx;
      })();

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: key,
          model,
          modelId,
          messages: result.messages.map((m) => ({ role: m.role, content: m.content })),
          userPublicId: result.parentPublicId,
          sourcePublicId: assistantPublicId,
          branchReason: "retry",
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("请求失败");

      await consumeChatSSE(res.body, {
        onDelta: (t) => set((s) => patchRuntime(s, key, (r) => {
          if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
          const copy = [...r.messages];
          copy[assistantIdx] = { ...copy[assistantIdx], content: (copy[assistantIdx].content ?? "") + t };
          return { ...r, messages: copy };
        })),
        onReasoning: (t) => set((s) => patchRuntime(s, key, (r) => {
          if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
          const copy = [...r.messages];
          copy[assistantIdx] = { ...copy[assistantIdx], reasoning: (copy[assistantIdx].reasoning ?? "") + t };
          return { ...r, messages: copy };
        })),
        // 回填后端真实 publicId,覆盖 retryFromMessage 生成的占位 UUID;
        // 否则生成结束后 refreshVersionInfo 拿占位 id 查不到兄弟,版本切换器无法显示。
        onAssistantMessage: (publicId) => set((s) => patchRuntime(s, key, (r) => {
          if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
          const copy = [...r.messages];
          copy[assistantIdx] = { ...copy[assistantIdx], publicId };
          return { ...r, messages: copy };
        })),
      });
    } catch (err) {
      const { content } = handleStreamError(err, "网络错误");
      if (!content.includes("[错误]")) console.error("regenerate failed:", err);
    } finally {
      set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: false, abortController: null })));
    }
  },

  editAndResend: async (key, userPublicId, newContent, model, modelId) => {
    const rt = getRuntime(get(), key);
    if (key === NEW_CONVERSATION_KEY || rt.streaming || !userPublicId || !newContent.trim()) return;
    set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: true })));
    const controller = new AbortController();
    set((s) => patchRuntime(s, key, (r) => ({ ...r, abortController: controller })));

    try {
      const result = await editMessage(key, userPublicId, newContent.trim());
      set((s) => patchRuntime(s, key, (r) => {
        const idx = r.messages.findIndex((x) => x.publicId === userPublicId);
        if (idx < 0) return r;
        const replaced: ChatMessage = { ...r.messages[idx], content: newContent.trim() };
        return { ...r, messages: [...r.messages.slice(0, idx), replaced] };
      }));
      const assistantIdx = (() => {
        let idx = -1;
        set((s) => patchRuntime(s, key, (r) => {
          idx = r.messages.length;
          return { ...r, messages: [...r.messages, { role: "assistant" as const, content: "" }] };
        }));
        return idx;
      })();

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: key,
          model,
          modelId,
          messages: result.messages.map((m) => ({ role: m.role, content: m.content })),
          userPublicId,
          branchReason: "edit",
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("请求失败");

      await consumeChatSSE(res.body, {
        onDelta: (t) => set((s) => patchRuntime(s, key, (r) => {
          if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
          const copy = [...r.messages];
          copy[assistantIdx] = { ...copy[assistantIdx], content: (copy[assistantIdx].content ?? "") + t };
          return { ...r, messages: copy };
        })),
        onReasoning: (t) => set((s) => patchRuntime(s, key, (r) => {
          if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
          const copy = [...r.messages];
          copy[assistantIdx] = { ...copy[assistantIdx], reasoning: (copy[assistantIdx].reasoning ?? "") + t };
          return { ...r, messages: copy };
        })),
      });
    } catch (err) {
      const { content } = handleStreamError(err, "网络错误");
      if (!content.includes("[错误]")) console.error("editAndResend failed:", err);
    } finally {
      set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: false, abortController: null })));
    }
  },

  deleteMessage: async (key, publicId) => {
    if (!publicId) return;
    try {
      const deletedIds = await softDeleteMessage(publicId);
      const removeSet = new Set(deletedIds);
      removeSet.add(publicId);
      set((s) => patchRuntime(s, key, (r) => ({
        ...r,
        messages: r.messages.filter((m) => !removeSet.has(m.publicId ?? "")),
      })));
    } catch (err) {
      console.error("deleteMessage failed:", err);
    }
  },

  continueGeneration: async (key, assistantPublicId, model, modelId) => {
    const rt = getRuntime(get(), key);
    if (key === NEW_CONVERSATION_KEY || rt.streaming || !assistantPublicId) return;
    const assistantIdx = rt.messages.findIndex((x) => x.publicId === assistantPublicId);
    if (assistantIdx < 0) return; // 续写必须落在既有 assistant 消息上
    set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: true })));
    const controller = new AbortController();
    set((s) => patchRuntime(s, key, (r) => ({ ...r, abortController: controller })));

    try {
      const result = await continueMessage(key, assistantPublicId);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: key,
          model,
          modelId,
          messages: result.messages.map((m) => ({ role: m.role, content: m.content })),
          continueFromPublicId: assistantPublicId,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("请求失败");

      // 续写:delta 追加到既有 assistant 消息内容末尾(不清空原内容)
      await consumeChatSSE(res.body, {
        onDelta: (t) => set((s) => patchRuntime(s, key, (r) => {
          if (assistantIdx >= r.messages.length || r.messages[assistantIdx].publicId !== assistantPublicId) return r;
          const copy = [...r.messages];
          copy[assistantIdx] = { ...copy[assistantIdx], content: (copy[assistantIdx].content ?? "") + t };
          return { ...r, messages: copy };
        })),
        onReasoning: (t) => set((s) => patchRuntime(s, key, (r) => {
          if (assistantIdx >= r.messages.length || r.messages[assistantIdx].publicId !== assistantPublicId) return r;
          const copy = [...r.messages];
          copy[assistantIdx] = { ...copy[assistantIdx], reasoning: (copy[assistantIdx].reasoning ?? "") + t };
          return { ...r, messages: copy };
        })),
      });
      // 续写完整结束:把该 assistant 从 interrupted 转为 success,避免对已补全内容再次续写
      set((s) => patchRuntime(s, key, (r) => ({
        ...r,
        messages: r.messages.map((m) =>
          m.publicId === assistantPublicId ? { ...m, status: "success" as const } : m,
        ),
      })));
    } catch (err) {
      const { content } = handleStreamError(err, "网络错误");
      if (!content.includes("[错误]")) console.error("continueGeneration failed:", err);
    } finally {
      set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: false, abortController: null })));
    }
  },

  switchVersion: async (key, publicId, direction) => {
    const rt = getRuntime(get(), key);
    if (rt.streaming || !publicId) return;
    try {
      const { siblings } = await getMessageSiblings(publicId);
      if (siblings.length <= 1) return;
      const curIdx = siblings.findIndex((s) => s.publicId === publicId);
      if (curIdx < 0) return;
      const nextIdx = direction === "prev" ? (curIdx - 1 + siblings.length) % siblings.length : (curIdx + 1) % siblings.length;
      const target = siblings[nextIdx];
      set((s) => patchRuntime(s, key, (r) => {
        const idx = r.messages.findIndex((x) => x.publicId === publicId);
        if (idx < 0) return r;
        const replaced: ChatMessage = {
          ...r.messages[idx],
          publicId: target.publicId,
          content: target.content,
          reasoning: target.reasoning ?? undefined,
          artifacts: undefined,
          trace: undefined,
          toolCalls: undefined,
          searchResults: undefined,
          versionInfo: { current: nextIdx + 1, total: siblings.length },
        };
        return { ...r, messages: [...r.messages.slice(0, idx), replaced] };
      }));
    } catch (err) {
      console.error("switchVersion failed:", err);
    }
  },

  refreshVersionInfo: async (key, publicId) => {
    try {
      const { siblings } = await getMessageSiblings(publicId);
      if (siblings.length <= 1) return;
      const curIdx = siblings.findIndex((s) => s.publicId === publicId);
      if (curIdx < 0) return;
      set((s) => patchRuntime(s, key, (r) => ({
        ...r,
        messages: r.messages.map((x) =>
          x.publicId === publicId ? { ...x, versionInfo: { current: curIdx + 1, total: siblings.length } } : x,
        ),
      })));
    } catch {
      /* 忽略 */
    }
  },

  stopGeneration: (key) => {
    const rt = getRuntime(get(), key);
    if (rt.abortController) {
      rt.abortController.abort();
    }
    set((s) => patchRuntime(s, key, (r) => {
      // 中断后把最后一条 assistant 标记为 interrupted,供"继续生成"按钮显示
      const msgs = [...r.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], status: "interrupted" };
          break;
        }
      }
      return { ...r, messages: msgs, streaming: false, abortController: null };
    }));
  },
}));
