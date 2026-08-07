"use client";

import { create } from "zustand";
import {
  createConversation,
  getConversationTitleStateAction,
  type CreateConversationOptions,
} from "@/features/chat/actions/conversations";
import { retryFromMessage, editMessage, getMessageSiblings, selectMessageVersion, softDeleteMessage, continueMessage } from "@/features/chat/actions/branch";
import {
  consumeChatSSE,
  handleStreamError,
  type SSEHandlers,
} from "@/features/chat/model/sse";
import type { ChatTerminalStatus } from "@/lib/chat/sse-contract";
import type {
  ChatMessage,
  ChatMessageAttachment,
  MessageFeedback,
  MessageRunMetadata,
  ToolCallRecord,
} from "@/features/chat/model/types";
import type { ReasoningLevel, WebSearchTraceBackend } from "@/db/types";

/** 新会话(尚无会话 id)在 store 内使用的隔离键。 */
export const NEW_CONVERSATION_KEY = "__new__";

/** 从首条用户消息派生乐观标题(≤16 字符);后台真实标题写入后由短轮询覆盖。 */
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
  createOptions?: {
    outputModeId?: string | null;
    renderStyleId?: string | null;
    reasoning?: ReasoningLevel;
    reasoningByModelId?: Record<string, ReasoningLevel>;
  };
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
      hasAttachments?: boolean;
      uploadAttachments?: (convId: string) => Promise<ChatMessageAttachment[]>;
      onAttachmentsConsumed?: (fileIds: string[]) => void;
      onRequestAccepted?: () => void;
      onRequestRejected?: (message: string) => void;
      onUserMessagePublicId?: (publicId: string) => void;
      onTitleUpdated?: () => void;
      onConversationCreated?: (newConvId: string) => void;
    },
  ) => Promise<void>;
  regenerate: (key: string, assistantPublicId: string, model: string, modelId: string) => Promise<void>;
  editAndResend: (
    key: string,
    userPublicId: string,
    newContent: string,
    attachmentFileIds: string[],
    model: string,
    modelId: string,
  ) => Promise<void>;
  deleteMessage: (key: string, publicId: string) => Promise<void>;
  continueGeneration: (key: string, assistantPublicId: string, model: string, modelId: string) => Promise<void>;
  switchVersion: (key: string, publicId: string, direction: "prev" | "next") => Promise<void>;
  refreshVersionInfo: (key: string, publicId: string) => Promise<void>;
  /** 同步某条消息的反馈(乐观更新 / 失败回滚由调用方控制)。 */
  setMessageFeedbackLocal: (key: string, publicId: string, feedback: MessageFeedback | undefined) => void;
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

/** 合批的增量字段:正文 / 思考。 */
type DeltaField = "content" | "reasoning";
interface PendingDelta {
  key: string;
  idx: number;
  field: DeltaField;
  text: string;
}

/**
 * 流式 delta 合批缓冲(层1):逐 token 的 delta 先累积于此,rAF 每帧最多 flush 一次,
 * 避免每个 token 都 [...messages] 整组替换 + set 引发的高频重渲染卡顿。
 * 按 `${key}:${idx}:${field}` 聚合,天然支持多会话并行流式。
 */
const deltaBuffer = new Map<string, PendingDelta>();
let deltaFlushRaf = 0;
let deltaFlushTimeout = 0;

/**
 * 流式正文每帧最多追加的字符数。rAF 每帧约 16ms,15 字/帧 ≈ 900 字/秒,
 * 使上游 token 再快也保持逐帧打字节奏,避免一坨一坨蹦出;reasoning 不限。
 */
const MAX_CONTENT_CHARS_PER_FRAME = 15;

/**
 * rAF 兜底间隔:tab 切后台时浏览器会暂停/降频 rAF,纯靠 rAF 流式会卡死、回前台一次性放出积压。
 * 另起 setTimeout 兜底,后台时仍能(被降频到 ~1s)推进 flush;前台时 rAF(~16ms)总先到并 cancel 它,基本不触发。
 */
const STREAM_FLUSH_FALLBACK_MS = 50;
const TITLE_POLL_INTERVAL_MS = 1_000;
const TITLE_POLL_MAX_DURATION_MS = 60_000;
const titlePolls = new Map<string, Promise<void>>();

function waitForTitlePoll(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function queryTitleBeforeDeadline(
  conversationId: string,
  deadline: number,
): Promise<
  | { kind: "state"; state: Awaited<ReturnType<typeof getConversationTitleStateAction>> }
  | { kind: "error" }
  | { kind: "deadline" }
> {
  return new Promise((resolve) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      resolve({ kind: "deadline" });
      return;
    }

    const timer = globalThis.setTimeout(() => resolve({ kind: "deadline" }), remaining);
    void getConversationTitleStateAction(conversationId).then(
      (state) => {
        globalThis.clearTimeout(timer);
        resolve({ kind: "state", state });
      },
      () => {
        globalThis.clearTimeout(timer);
        resolve({ kind: "error" });
      },
    );
  });
}

async function pollConversationTitle(conversationId: string): Promise<void> {
  const deadline = Date.now() + TITLE_POLL_MAX_DURATION_MS;
  while (Date.now() < deadline) {
    const result = await queryTitleBeforeDeadline(conversationId, deadline);
    if (result.kind === "deadline") return;
    if (result.kind === "state" && result.state) {
      const state = result.state;
      useChatStreamStore.setState((current) => {
        const optimistic = current.optimisticConversation;
        if (!optimistic || optimistic.id !== conversationId || optimistic.title === state.title) {
          return current;
        }
        return { optimisticConversation: { ...optimistic, title: state.title } };
      });
      if (!state.pending) return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await waitForTitlePoll(Math.min(TITLE_POLL_INTERVAL_MS, remaining));
  }
}

function startConversationTitlePoll(conversationId: string): void {
  if (titlePolls.has(conversationId)) return;
  const poll = pollConversationTitle(conversationId).finally(() => {
    if (titlePolls.get(conversationId) === poll) titlePolls.delete(conversationId);
  });
  titlePolls.set(conversationId, poll);
}

/**
 * 每帧最多一次:把积压增量按会话合并,单次 setState 写回各 runtime。
 * force=false(常规 rAF/兜底路径)时,content 字段每帧最多追加 MAX_CONTENT_CHARS_PER_FRAME 字,
 * 剩余留 buffer 下一帧续放;force=true(流结束/中断强制 flush)时一次性放完,避免末尾积压丢失。
 */
function flushDeltas(force = false) {
  // 进入 flush 即取消已排队的 rAF 与兜底定时器,避免重复 flush(本帧可能由其中之一触发,另一个仍排队)。
  if (deltaFlushRaf) {
    cancelAnimationFrame(deltaFlushRaf);
    deltaFlushRaf = 0;
  }
  if (deltaFlushTimeout) {
    window.clearTimeout(deltaFlushTimeout);
    deltaFlushTimeout = 0;
  }
  if (deltaBuffer.size === 0) return;
  const entries = Array.from(deltaBuffer.values());
  deltaBuffer.clear();
  // 预算本帧放出/留存的切片,避免在 setState 回调内产生副作用。
  const remainders: PendingDelta[] = [];
  const emits = entries.map((d) => {
    if (!force && d.field === "content" && d.text.length > MAX_CONTENT_CHARS_PER_FRAME) {
      remainders.push({ ...d, text: d.text.slice(MAX_CONTENT_CHARS_PER_FRAME) });
      return { ...d, text: d.text.slice(0, MAX_CONTENT_CHARS_PER_FRAME) };
    }
    return d;
  });
  useChatStreamStore.setState((s) => {
    let runtimes = s.runtimes;
    let changed = false;
    for (const d of emits) {
      const rt = runtimes[d.key];
      if (!rt || d.idx < 0 || d.idx >= rt.messages.length) continue;
      const msgs = [...rt.messages];
      const cur = msgs[d.idx];
      msgs[d.idx] =
        d.field === "content"
          ? { ...cur, content: (cur.content ?? "") + d.text }
          : { ...cur, reasoning: (cur.reasoning ?? "") + d.text };
      runtimes = { ...runtimes, [d.key]: { ...rt, messages: msgs } };
      changed = true;
    }
    return changed ? { runtimes } : s;
  });
  // 留存的 content 尾巴塞回 buffer,调度下一帧继续放。
  for (const r of remainders) {
    const bk = `${r.key}:${r.idx}:${r.field}`;
    const ex = deltaBuffer.get(bk);
    if (ex) ex.text += r.text;
    else deltaBuffer.set(bk, r);
  }
  if (deltaBuffer.size > 0 && !deltaFlushRaf && !deltaFlushTimeout) {
    deltaFlushRaf = requestAnimationFrame(() => flushDeltas());
    deltaFlushTimeout = window.setTimeout(() => flushDeltas(), STREAM_FLUSH_FALLBACK_MS);
  }
}

/** 累积一条增量并调度下一帧 flush;同帧内多次调用只累积不 set。 */
function enqueueDelta(key: string, idx: number, field: DeltaField, text: string) {
  if (!text) return;
  const bk = `${key}:${idx}:${field}`;
  const ex = deltaBuffer.get(bk);
  if (ex) ex.text += text;
  else deltaBuffer.set(bk, { key, idx, field, text });
  if (deltaFlushRaf || deltaFlushTimeout) return;
  deltaFlushRaf = requestAnimationFrame(() => flushDeltas());
  deltaFlushTimeout = window.setTimeout(() => flushDeltas(), STREAM_FLUSH_FALLBACK_MS);
}

/** 同步强制 flush:流式结束/中断前调用,避免最后一帧积压丢失。 */
function flushDeltasNow() {
  if (deltaFlushRaf) {
    cancelAnimationFrame(deltaFlushRaf);
    deltaFlushRaf = 0;
  }
  if (deltaFlushTimeout) {
    window.clearTimeout(deltaFlushTimeout);
    deltaFlushTimeout = 0;
  }
  flushDeltas(true);
}

/**
 * 把文本追加到某会话指定消息的 content 末尾(错误/停止标记专用)。
 * 调用前应先 flushDeltasNow() 落库缓冲正文,保证"正文在前、标记在后",
 * 避免标记直接 set 后被 finally 的 flushDeltasNow 残留正文赶到中间。
 */
function appendContentAt(key: string, idx: number, text: string) {
  if (!text || idx < 0) return;
  useChatStreamStore.setState((s) => {
    const rt = s.runtimes[key];
    if (!rt || idx >= rt.messages.length) return s;
    const copy = [...rt.messages];
    copy[idx] = { ...copy[idx], content: (copy[idx].content ?? "") + text };
    return { runtimes: { ...s.runtimes, [key]: { ...rt, messages: copy } } };
  });
}

/** 仅撤回当前工具轮已经流出的精确正文后缀，保留续写前已有内容。 */
function retractContentAt(key: string, idx: number, text: string) {
  if (!text || idx < 0) return;
  useChatStreamStore.setState((s) => {
    const rt = s.runtimes[key];
    if (!rt || idx >= rt.messages.length) return s;
    const content = rt.messages[idx].content ?? "";
    if (!content.endsWith(text)) return s;
    const copy = [...rt.messages];
    copy[idx] = { ...copy[idx], content: content.slice(0, -text.length) };
    return { runtimes: { ...s.runtimes, [key]: { ...rt, messages: copy } } };
  });
}

/** 用终态 run 元数据覆盖目标 assistant,保持其他流式字段不变。 */
function setRunMetadataAt(
  key: string,
  idx: number,
  runMetadata: MessageRunMetadata,
): void {
  useChatStreamStore.setState((state) => {
    const runtime = state.runtimes[key];
    if (!runtime || idx < 0 || idx >= runtime.messages.length) return state;
    const messages = [...runtime.messages];
    messages[idx] = { ...messages[idx], runMetadata };
    return {
      runtimes: {
        ...state.runtimes,
        [key]: { ...runtime, messages },
      },
    };
  });
}

/** 将 wire 终态投影为消息完整性状态；failed 与 interrupted 均允许继续生成。 */
function setCompletionStatusAt(
  key: string,
  idx: number,
  terminalStatus: ChatTerminalStatus,
): void {
  useChatStreamStore.setState((state) => {
    const runtime = state.runtimes[key];
    if (!runtime || idx < 0 || idx >= runtime.messages.length) return state;
    const messages = [...runtime.messages];
    messages[idx] = {
      ...messages[idx],
      status: terminalStatus === "success" ? "success" : "interrupted",
    };
    return {
      runtimes: {
        ...state.runtimes,
        [key]: { ...runtime, messages },
      },
    };
  });
}

/** 将搜索来源并入目标 assistant；同一 URL 只展示一次。 */
function mergeSearchResultsAt(
  key: string,
  idx: number,
  results: NonNullable<ChatMessage["searchResults"]>,
  backend?: WebSearchTraceBackend,
): void {
  useChatStreamStore.setState((state) => {
    const runtime = state.runtimes[key];
    if (!runtime || idx < 0 || idx >= runtime.messages.length) return state;
    const messages = [...runtime.messages];
    const message = messages[idx];
    const byUrl = new Map((message.searchResults ?? []).map((result) => [result.url, result]));
    for (const result of results) {
      byUrl.set(result.url, { ...byUrl.get(result.url), ...result });
    }
    const next: ChatMessage = { ...message, searchResults: Array.from(byUrl.values()) };
    if (backend) {
      const backendKey = (value: WebSearchTraceBackend) => `${value.type}:${value.id ?? value.name}`;
      const byBackend = new Map(
        (message.searchBackends ?? []).map((value) => [backendKey(value), value]),
      );
      byBackend.set(backendKey(backend), backend);
      next.searchBackends = Array.from(byBackend.values());
    }
    messages[idx] = next;
    return {
      runtimes: {
        ...state.runtimes,
        [key]: { ...runtime, messages },
      },
    };
  });
}

function addToolCallAt(key: string, idx: number, record: ToolCallRecord): void {
  useChatStreamStore.setState((state) => {
    const runtime = state.runtimes[key];
    if (!runtime || idx < 0 || idx >= runtime.messages.length) return state;
    const messages = [...runtime.messages];
    messages[idx] = {
      ...messages[idx],
      toolCalls: [...(messages[idx].toolCalls ?? []), record],
    };
    return {
      runtimes: {
        ...state.runtimes,
        [key]: { ...runtime, messages },
      },
    };
  });
}

/** 新事件按 toolCallId 精确关联；旧事件缺 ID 时回退到最后一个同名调用。 */
function finishToolCallAt(
  key: string,
  idx: number,
  toolName: string,
  isError: boolean,
  toolCallId?: string,
  details?: Pick<ToolCallRecord, "searchBackend" | "searchAttempts" | "statusDetail">,
): void {
  useChatStreamStore.setState((state) => {
    const runtime = state.runtimes[key];
    if (!runtime || idx < 0 || idx >= runtime.messages.length) return state;
    const messages = [...runtime.messages];
    const calls = [...(messages[idx].toolCalls ?? [])];
    for (let i = calls.length - 1; i >= 0; i--) {
      const matches = toolCallId
        ? calls[i].toolCallId === toolCallId
        : calls[i].toolName === toolName && calls[i].status === "calling";
      if (matches) {
        calls[i] = {
          ...calls[i],
          status: isError ? "error" : "done",
          ...details,
        };
        break;
      }
    }
    messages[idx] = { ...messages[idx], toolCalls: calls };
    return {
      runtimes: {
        ...state.runtimes,
        [key]: { ...runtime, messages },
      },
    };
  });
}

/** 四种生成动作共享同一套工具与搜索事件投影。 */
function toolAndSearchHandlers(key: string, assistantIdx: number): Partial<SSEHandlers> {
  return {
    onContentRetract: (text) => {
      flushDeltasNow();
      retractContentAt(key, assistantIdx, text);
    },
    onToolCall: (toolName, args, toolCallId) =>
      addToolCallAt(key, assistantIdx, { toolCallId, toolName, args, status: "calling" }),
    onToolResult: (toolName, isError, toolCallId) =>
      finishToolCallAt(key, assistantIdx, toolName, isError, toolCallId),
    onSearchCompleted: (toolCallId, citations, backend, attempts) => {
      mergeSearchResultsAt(key, assistantIdx, citations, backend);
      finishToolCallAt(
        key,
        assistantIdx,
        "web_search",
        false,
        toolCallId,
        {
          ...(backend ? { searchBackend: backend } : {}),
          ...(attempts?.length
            ? { searchAttempts: attempts.map(({ backend: attemptedBackend, outcome }) => ({
                backend: attemptedBackend,
                outcome,
              })) }
            : {}),
        },
      );
    },
    onSearchFailed: (toolCallId, reason, attempts) =>
      finishToolCallAt(
        key,
        assistantIdx,
        "web_search",
        true,
        toolCallId,
        {
          statusDetail: reason,
          ...(attempts?.length
            ? { searchAttempts: attempts.map(({ backend, outcome }) => ({ backend, outcome })) }
            : {}),
        },
      ),
    // 兼容同版本部署期间的旧搜索结果帧。
    onSearchResult: (results) => mergeSearchResultsAt(key, assistantIdx, results),
  };
}

export const useChatStreamStore = create<ChatStreamState>((set, get) => ({
  runtimes: {},
  activeConversationId: null,
  optimisticConversation: null,

  hydrate: (key, messages) => {
    // 进入新对话 runtime 时清掉旧活动会话；已有会话仍可在后台继续流式。
    if (key === NEW_CONVERSATION_KEY && get().activeConversationId !== null) {
      set({ activeConversationId: null });
    }
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
    if ((!text.trim() && !hooks?.hasAttachments) || !opts.model || rt.streaming) return;
    set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: true })));

    const controller = new AbortController();
    set((s) => patchRuntime(s, key, (r) => ({ ...r, abortController: controller })));
    hooks?.onRequestAccepted?.();

    // 从已迁移后的运行时中读取真实会话 id(若存在)
    const convId = key === NEW_CONVERSATION_KEY ? null : key;
    let newConvId: string | null = null;
    let activeKey = key;
    let userMsgIdx = -1;
    let assistantIdx = -1;
    let requestMessagesAppended = false;
    let preflightRolledBack = false;
    let streamErrorReceived = false;

    try {
      let resolvedConvId = convId;
      if (!resolvedConvId) {
        const createOpts: CreateConversationOptions = {
          outputModeId: opts.createOptions?.outputModeId,
          renderStyleId: opts.createOptions?.renderStyleId,
          webSearch: opts.webSearch,
          cardIds: opts.instructionCardIds,
          kbIds: opts.knowledgeBaseIds,
          reasoningByModelId: opts.createOptions?.reasoningByModelId,
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

      activeKey = resolvedConvId;
      const attachments = hooks?.uploadAttachments
        ? await hooks.uploadAttachments(resolvedConvId)
        : [];
      if (!text.trim() && attachments.length === 0) throw new Error("消息内容和图片不能同时为空");
      const fileIds = attachments.map((attachment) => attachment.fileId);
      const baseMessages = getRuntime(get(), activeKey).messages;
      const userMsg: ChatMessage = {
        role: "user",
        content: text.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: new Date().toISOString(),
      };
      const nextMessages = [...baseMessages, userMsg];
      userMsgIdx = baseMessages.length;
      assistantIdx = userMsgIdx + 1;
      set((s) => patchRuntime(s, activeKey, (runtime) => ({
        ...runtime,
        messages: [
          ...nextMessages,
          { role: "assistant", content: "", createdAt: new Date().toISOString() },
        ],
      })));
      requestMessagesAppended = true;

      // 取上一轮 assistant 的 publicId 作为 parentPublicId,使后端能把本轮 user 正确挂到主线上。
      // 缺失会导致 parentId 断链,刷新后 getVisibleBranch 回溯主线时前面历史会被丢弃。
      const parentPublicId = (() => {
        for (let i = baseMessages.length - 1; i >= 0; i--) {
          if (baseMessages[i].role === "assistant") return baseMessages[i].publicId;
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
          webSearch: opts.webSearch ?? false,
          ...(opts.knowledgeBaseIds && opts.knowledgeBaseIds.length > 0 ? { knowledgeBaseIds: opts.knowledgeBaseIds } : {}),
          ...(opts.createOptions?.outputModeId !== undefined
            ? { outputModeId: opts.createOptions.outputModeId }
            : {}),
          ...(opts.createOptions?.reasoning !== undefined
            ? { reasoning: opts.createOptions.reasoning }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let message = "请求失败";
        try {
          const payload = (await res.json()) as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          /* 非 JSON 错误沿用通用文案。 */
        }
        set((s) => patchRuntime(s, activeKey, (runtime) => ({
          ...runtime,
          messages: baseMessages,
        })));
        preflightRolledBack = true;
        hooks?.onRequestRejected?.(message);
        throw new Error(message);
      }
      hooks?.onAttachmentsConsumed?.(fileIds);
      if (newConvId) startConversationTitlePoll(newConvId);

      const terminalStatus = await consumeChatSSE(res.body, {
        ...toolAndSearchHandlers(activeKey, assistantIdx),
        onDelta: (t) => enqueueDelta(activeKey, assistantIdx, "content", t),
        onReasoning: (t) => enqueueDelta(activeKey, assistantIdx, "reasoning", t),
        onError: (err) => {
          streamErrorReceived = true;
          // 先 flush 缓冲正文再追加错误,保证"正文在前、错误在后";改覆盖为追加,避免丢已生成正文。
          flushDeltasNow();
          appendContentAt(activeKey, assistantIdx, `\n\n[错误] ${err}`);
        },
        onFinish: (metadata) => setRunMetadataAt(activeKey, assistantIdx, metadata),
        onUserMessage: (publicId, createdAt) => {
          set((s) => patchRuntime(s, activeKey, (r) => {
            if (userMsgIdx >= r.messages.length) return r;
            if (r.messages[userMsgIdx].role !== "user") return r;
            const updated = [...r.messages];
            updated[userMsgIdx] = {
              ...updated[userMsgIdx],
              publicId,
              createdAt: createdAt ?? updated[userMsgIdx].createdAt,
            };
            return { ...r, messages: updated };
          }));
          hooks?.onUserMessagePublicId?.(publicId);
        },
        onAssistantMessage: (publicId, createdAt) => {
          // 回填 assistant 占位的 publicId,使生成期间即可显示操作按钮(无需刷新)
          set((s) => patchRuntime(s, activeKey, (r) => {
            if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
            const updated = [...r.messages];
            updated[assistantIdx] = {
              ...updated[assistantIdx],
              publicId,
              createdAt: createdAt ?? updated[assistantIdx].createdAt,
            };
            return { ...r, messages: updated };
          }));
        },
        onTitleUpdated: (title, conversationId) => {
          // 保留 SSE 标题事件兼容路径；后台 worker 的最终标题由独立短轮询收敛。
          const opt = get().optimisticConversation;
          if (opt && opt.id === conversationId) {
            set({ optimisticConversation: { ...opt, title } });
          }
          hooks?.onTitleUpdated?.();
        },
      });
      flushDeltasNow();
      setCompletionStatusAt(activeKey, assistantIdx, terminalStatus);
    } catch (err) {
      // 先 flush 缓冲的限速正文,再追加错误/停止标记,否则标记会落在 finally flushDeltasNow 的残留正文之前,夹在正文中间。
      flushDeltasNow();
      const { content } = handleStreamError(err, "网络错误");
      if (!content.includes("[错误]")) console.error("send failed:", err);
      if (requestMessagesAppended && !preflightRolledBack) {
        if (!streamErrorReceived) appendContentAt(activeKey, assistantIdx, content);
        setCompletionStatusAt(activeKey, assistantIdx, "interrupted");
      } else if (!preflightRolledBack) {
        hooks?.onRequestRejected?.(err instanceof Error ? err.message : "图片上传失败");
      }
    } finally {
      // 流式结束前同步 flush 残留 delta,避免最后一帧积压丢失,再置 streaming:false。
      flushDeltasNow();
      set((s) => patchRuntime(s, activeKey, (r) => ({ ...r, streaming: false, abortController: null })));
    }
  },

  regenerate: async (key, assistantPublicId, model, modelId) => {
    const rt = getRuntime(get(), key);
    if (key === NEW_CONVERSATION_KEY || rt.streaming || !assistantPublicId) return;
    set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: true })));
    const controller = new AbortController();
    set((s) => patchRuntime(s, key, (r) => ({ ...r, abortController: controller })));
    const originalMessages = rt.messages;
    let preflightRolledBack = false;
    let streamErrorReceived = false;
    let assistantIdx = -1;

    try {
      let generatedAssistantPublicId: string | null = null;
      const result = await retryFromMessage(key, assistantPublicId);
      assistantIdx = (() => {
        let idx = -1;
        set((s) => patchRuntime(s, key, (r) => {
          idx = r.messages.findIndex((x) => x.publicId === assistantPublicId);
          if (idx < 0) return r;
          const replaced: ChatMessage = {
            role: "assistant",
            content: "",
            publicId: result.newAssistantPublicId,
            createdAt: new Date().toISOString(),
          };
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
      if (!res.ok || !res.body) {
        set((s) => patchRuntime(s, key, (runtime) => ({
          ...runtime,
          messages: originalMessages,
        })));
        preflightRolledBack = true;
        throw new Error("请求失败");
      }

      const terminalStatus = await consumeChatSSE(res.body, {
        ...toolAndSearchHandlers(key, assistantIdx),
        onDelta: (t) => enqueueDelta(key, assistantIdx, "content", t),
        onReasoning: (t) => enqueueDelta(key, assistantIdx, "reasoning", t),
        onError: (error) => {
          streamErrorReceived = true;
          flushDeltasNow();
          appendContentAt(key, assistantIdx, `\n\n[错误] ${error}`);
        },
        onFinish: (metadata) => setRunMetadataAt(key, assistantIdx, metadata),
        // 回填后端真实 publicId,覆盖 retryFromMessage 生成的占位 UUID;
        // 否则生成结束后 refreshVersionInfo 拿占位 id 查不到兄弟,版本切换器无法显示。
        onAssistantMessage: (publicId, createdAt) => {
          generatedAssistantPublicId = publicId;
          set((s) => patchRuntime(s, key, (r) => {
            if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
            const copy = [...r.messages];
            copy[assistantIdx] = {
              ...copy[assistantIdx],
              publicId,
              createdAt: createdAt ?? copy[assistantIdx].createdAt,
            };
            return { ...r, messages: copy };
          }));
        },
      });
      flushDeltasNow();
      setCompletionStatusAt(key, assistantIdx, terminalStatus);
      if (generatedAssistantPublicId) {
        try {
          await selectMessageVersion(generatedAssistantPublicId);
          // 重新生成才会新增 sibling;历史消息的版本信息已由 SSR versionMap 提供。
          await get().refreshVersionInfo(key, generatedAssistantPublicId);
        } catch (err) {
          console.error("persist regenerated version failed:", err);
        }
      }
    } catch (err) {
      flushDeltasNow();
      const { content } = handleStreamError(err, "网络错误");
      if (!content.includes("[错误]")) console.error("regenerate failed:", err);
      if (!preflightRolledBack) {
        if (!streamErrorReceived) appendContentAt(key, assistantIdx, content);
        setCompletionStatusAt(key, assistantIdx, "interrupted");
      }
    } finally {
      flushDeltasNow();
      set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: false, abortController: null })));
    }
  },

  editAndResend: async (key, userPublicId, newContent, attachmentFileIds, model, modelId) => {
    const rt = getRuntime(get(), key);
    if (
      key === NEW_CONVERSATION_KEY
      || rt.streaming
      || !userPublicId
      || (!newContent.trim() && attachmentFileIds.length === 0)
    ) return;
    set((s) => patchRuntime(s, key, (r) => ({ ...r, streaming: true })));
    const controller = new AbortController();
    set((s) => patchRuntime(s, key, (r) => ({ ...r, abortController: controller })));
    let streamErrorReceived = false;
    let assistantIdx = -1;

    try {
      const result = await editMessage(
        key,
        userPublicId,
        newContent.trim(),
        attachmentFileIds,
        model,
        modelId,
      );
      set((s) => patchRuntime(s, key, (r) => {
        const idx = r.messages.findIndex((x) => x.publicId === userPublicId);
        if (idx < 0) return r;
        const replaced: ChatMessage = {
          ...r.messages[idx],
          content: newContent.trim(),
          attachments: result.attachments.length > 0 ? result.attachments : undefined,
        };
        return { ...r, messages: [...r.messages.slice(0, idx), replaced] };
      }));
      assistantIdx = (() => {
        let idx = -1;
        set((s) => patchRuntime(s, key, (r) => {
          idx = r.messages.length;
          return {
            ...r,
            messages: [
              ...r.messages,
              {
                role: "assistant" as const,
                content: "",
                createdAt: new Date().toISOString(),
              },
            ],
          };
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

      const terminalStatus = await consumeChatSSE(res.body, {
        ...toolAndSearchHandlers(key, assistantIdx),
        onDelta: (t) => enqueueDelta(key, assistantIdx, "content", t),
        onReasoning: (t) => enqueueDelta(key, assistantIdx, "reasoning", t),
        onError: (error) => {
          streamErrorReceived = true;
          flushDeltasNow();
          appendContentAt(key, assistantIdx, `\n\n[错误] ${error}`);
        },
        onFinish: (metadata) => setRunMetadataAt(key, assistantIdx, metadata),
        onAssistantMessage: (publicId, createdAt) => {
          set((s) => patchRuntime(s, key, (r) => {
            if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
            const copy = [...r.messages];
            copy[assistantIdx] = {
              ...copy[assistantIdx],
              publicId,
              createdAt: createdAt ?? copy[assistantIdx].createdAt,
            };
            return { ...r, messages: copy };
          }));
        },
      });
      flushDeltasNow();
      setCompletionStatusAt(key, assistantIdx, terminalStatus);
    } catch (err) {
      flushDeltasNow();
      const { content } = handleStreamError(err, "网络错误");
      if (!content.includes("[错误]")) console.error("editAndResend failed:", err);
      if (!streamErrorReceived) appendContentAt(key, assistantIdx, content);
      setCompletionStatusAt(key, assistantIdx, "interrupted");
    } finally {
      flushDeltasNow();
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
    set((s) => patchRuntime(s, key, (r) => ({
      ...r,
      streaming: true,
      messages: r.messages.map((message, index) =>
        index === assistantIdx ? { ...message, runMetadata: undefined } : message,
      ),
    })));
    const controller = new AbortController();
    set((s) => patchRuntime(s, key, (r) => ({ ...r, abortController: controller })));
    let streamErrorReceived = false;

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
      const terminalStatus = await consumeChatSSE(res.body, {
        ...toolAndSearchHandlers(key, assistantIdx),
        // 续写增量同样走合批:流式期间该 idx 消息 publicId 稳定(switchVersion 被 streaming 阻止),可省 publicId 校验。
        onDelta: (t) => enqueueDelta(key, assistantIdx, "content", t),
        onReasoning: (t) => enqueueDelta(key, assistantIdx, "reasoning", t),
        onError: (error) => {
          streamErrorReceived = true;
          flushDeltasNow();
          appendContentAt(key, assistantIdx, `\n\n[错误] ${error}`);
        },
        onFinish: (metadata) => setRunMetadataAt(key, assistantIdx, metadata),
        onAssistantMessage: (publicId, createdAt) => {
          set((s) => patchRuntime(s, key, (r) => {
            if (assistantIdx < 0 || assistantIdx >= r.messages.length) return r;
            const copy = [...r.messages];
            copy[assistantIdx] = {
              ...copy[assistantIdx],
              publicId,
              createdAt: createdAt ?? copy[assistantIdx].createdAt,
            };
            return { ...r, messages: copy };
          }));
        },
      });
      flushDeltasNow();
      setCompletionStatusAt(key, assistantIdx, terminalStatus);
    } catch (err) {
      flushDeltasNow();
      const { content } = handleStreamError(err, "网络错误");
      if (!content.includes("[错误]")) console.error("continueGeneration failed:", err);
      if (!streamErrorReceived) appendContentAt(key, assistantIdx, content);
      setCompletionStatusAt(key, assistantIdx, "interrupted");
    } finally {
      flushDeltasNow();
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
      await selectMessageVersion(target.publicId);
      set((s) => patchRuntime(s, key, (r) => {
        const idx = r.messages.findIndex((x) => x.publicId === publicId);
        if (idx < 0) return r;
        const replaced: ChatMessage = {
          ...r.messages[idx],
          publicId: target.publicId,
          content: target.content,
          createdAt: target.createdAt ?? r.messages[idx].createdAt,
          reasoning: target.reasoning ?? undefined,
          runMetadata: target.runMetadata,
          artifacts: undefined,
          // P1-B: 用目标版本自身的 toolCalls 覆盖,无则清掉旧版本残留。
          toolCalls: target.toolCalls,
          searchResults: target.searchResults,
          searchBackends: target.searchBackends,
          // P2-A: 必须用目标版本 feedback 覆盖;无反馈时显式清空,不能残留旧版本。
          feedback: target.feedback,
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

  setMessageFeedbackLocal: (key, publicId, feedback) => {
    set((s) =>
      patchRuntime(s, key, (r) => ({
        ...r,
        messages: r.messages.map((x) =>
          x.publicId === publicId ? { ...x, feedback } : x,
        ),
      })),
    );
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
