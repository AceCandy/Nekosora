"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createConversation } from "@/features/chat/actions/conversations";
import { retryFromMessage, editMessage, getMessageSiblings } from "@/features/chat/actions/branch";
import { consumeChatSSE, handleStreamError } from "@/features/chat/model/sse";
import type { ChatMessage, ToolCallRecord } from "@/features/chat/model/types";

interface UseChatRuntimeOptions {
  initialConversationId?: string | null;
  initialMessages?: ChatMessage[];
  /** 发送前上传附件,返回 fileId 数组(由 useChatAttachments 提供)。 */
  uploadAttachments?: (convId: string) => Promise<string[]>;
}

/**
 * 聊天运行时核心 —— 封装消息状态、发送、重新生成、停止。
 *
 * 职责:
 *   - 维护 messages / streaming / conversationId 状态
 *   - send:发送消息(必要时先建会话 + 上传附件),流式接收
 *   - regenerate:基于某条 assistant 消息重新生成分支
 *   - stopGeneration:中断当前流
 *
 * 流式解析复用 consumeChatSSE,消除原 send/regenerate 的重复 reader 循环。
 */
export function useChatRuntime({
  initialConversationId = null,
  initialMessages = [],
  uploadAttachments,
}: UseChatRuntimeOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  /** 在指定 index 追加文本到 assistant 消息。 */
  const appendToMessage = useCallback((idx: number, text: string) => {
    setMessages((m) => {
      if (idx < 0 || idx >= m.length) return m;
      const copy = [...m];
      copy[idx] = {
        ...copy[idx],
        content: (copy[idx].content ?? "") + text,
      };
      return copy;
    });
  }, []);

  /** 在指定 index 追加 reasoning 文本到 assistant 消息。 */
  const appendReasoning = useCallback((idx: number, text: string) => {
    setMessages((m) => {
      if (idx < 0 || idx >= m.length) return m;
      const copy = [...m];
      copy[idx] = {
        ...copy[idx],
        reasoning: (copy[idx].reasoning ?? "") + text,
      };
      return copy;
    });
  }, []);

  /** 覆盖指定 index 消息的 content(用于 error 场景)。 */
  const setMessageContent = useCallback((idx: number, content: string) => {
    setMessages((m) => {
      if (idx < 0 || idx >= m.length) return m;
      const copy = [...m];
      copy[idx] = { ...copy[idx], content };
      return copy;
    });
  }, []);

  /** 在指定 index 上合并 trace 元数据。 */
  const mergeTrace = useCallback(
    (idx: number, trace: ChatMessage["trace"]) => {
      setMessages((m) => {
        if (idx < 0 || idx >= m.length) return m;
        const copy = [...m];
        copy[idx] = { ...copy[idx], trace };
        return copy;
      });
    },
    [],
  );

  /** 在指定 index 设置搜索引用来源(整体替换)。 */
  const setSearchResults = useCallback((idx: number, results: ChatMessage["searchResults"]) => {
    setMessages((m) => {
      if (idx < 0 || idx >= m.length) return m;
      const copy = [...m];
      copy[idx] = { ...copy[idx], searchResults: results };
      return copy;
    });
  }, []);

  /** 推入一次工具调用(status:calling)。 */
  const addToolCall = useCallback((idx: number, rec: ToolCallRecord) => {
    setMessages((m) => {
      if (idx < 0 || idx >= m.length) return m;
      const copy = [...m];
      copy[idx] = { ...copy[idx], toolCalls: [...(copy[idx].toolCalls ?? []), rec] };
      return copy;
    });
  }, []);

  /** 把最近一次同名工具调用标记为完成/出错。 */
  const finishToolCall = useCallback((idx: number, toolName: string, isError: boolean) => {
    setMessages((m) => {
      if (idx < 0 || idx >= m.length) return m;
      const copy = [...m];
      const calls = [...(copy[idx].toolCalls ?? [])];
      // 从后往前找第一个 calling 状态的同名调用
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i].toolName === toolName && calls[i].status === "calling") {
          calls[i] = { ...calls[i], status: isError ? "error" : "done" };
          break;
        }
      }
      copy[idx] = { ...copy[idx], toolCalls: calls };
      return copy;
    });
  }, []);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStreaming(false);
  }, []);

  const send = useCallback(
    async (text: string, model: string, instructionCardIds?: string[], webSearch?: boolean, knowledgeBaseIds?: string[]) => {
      if (!text.trim() || !model || streaming) return;
      const userMsg: ChatMessage = { role: "user", content: text.trim() };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setStreaming(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        let convId = conversationId;
        if (!convId) {
          convId = await createConversation(model);
          setConversationId(convId);
        }

        const fileIds = uploadAttachments ? await uploadAttachments(convId) : [];

        const assistantIdx = nextMessages.length;
        setMessages((m) => [...m, { role: "assistant", content: "" }]);

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: convId,
            model,
            messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
            fileIds,
            ...(instructionCardIds && instructionCardIds.length > 0 ? { instructionCardIds } : {}),
            ...(webSearch ? { webSearch: true } : {}),
            ...(knowledgeBaseIds && knowledgeBaseIds.length > 0 ? { knowledgeBaseIds } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error("请求失败");

        await consumeChatSSE(res.body, {
          onDelta: (t) => appendToMessage(assistantIdx, t),
          onReasoning: (t) => appendReasoning(assistantIdx, t),
          onToolCall: (name, args) => addToolCall(assistantIdx, { toolName: name, args, status: "calling" }),
          onToolResult: (name, isError) => finishToolCall(assistantIdx, name, isError),
          onSearchResult: (results) => setSearchResults(assistantIdx, results),
          onError: (err) => setMessageContent(assistantIdx, `[错误] ${err}`),
          onTrace: (trace) => mergeTrace(assistantIdx, trace),
          // 标题生成完成后刷新侧栏会话列表(layout 重新执行 listConversations)
          onTitleUpdated: () => router.refresh(),
        });
      } catch (err) {
        const lastIdx = (() => {
          let idx = -1;
          setMessages((m) => {
            idx = m.length - 1;
            return m;
          });
          return idx;
        })();
        const { content } = handleStreamError(err, "网络错误");
        if (lastIdx >= 0) {
          appendToMessage(lastIdx, content);
        }
      } finally {
        setStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [messages, streaming, conversationId, uploadAttachments, router, appendToMessage, appendReasoning, addToolCall, finishToolCall, setSearchResults, setMessageContent, mergeTrace],
  );

  const regenerate = useCallback(
    async (assistantPublicId: string, model: string) => {
      if (!conversationId || streaming || !assistantPublicId) return;
      setStreaming(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await retryFromMessage(conversationId, assistantPublicId);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "", publicId: result.newAssistantPublicId },
        ]);
        const assistantIdx = (() => {
          let idx = -1;
          setMessages((m) => {
            idx = m.length - 1;
            return m;
          });
          return idx;
        })();

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            model,
            messages: result.messages.map((m) => ({ role: m.role, content: m.content })),
            parentPublicId: result.parentPublicId,
            sourcePublicId: assistantPublicId,
            branchReason: "retry",
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error("请求失败");

        await consumeChatSSE(res.body, {
          onDelta: (t) => appendToMessage(assistantIdx, t),
          onReasoning: (t) => appendReasoning(assistantIdx, t),
        });
      } catch (err) {
        const { content } = handleStreamError(err, "网络错误");
        // regenerate 的错误只记日志,不污染消息(原实现如此)
        if (!content.includes("[错误]")) {
          console.error("regenerate failed:", err);
        }
      } finally {
        setStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [conversationId, streaming, appendToMessage, appendReasoning],
  );

  /**
   * 编辑用户消息后重新生成:从被编辑消息处派生新分支(branchReason="edit")。
   * 调 editMessage 取历史路径,本地把该 user 消息替换为新内容,追加 assistant 占位后流式发送。
   */
  const editAndResend = useCallback(
    async (userPublicId: string, newContent: string, model: string) => {
      if (!conversationId || streaming || !userPublicId || !newContent.trim()) return;
      setStreaming(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await editMessage(conversationId, userPublicId, newContent.trim());
        // 本地把被编辑的 user 消息替换为新内容,并截断其后所有消息(新分支起点)。
        setMessages((m) => {
          const idx = m.findIndex((x) => x.publicId === userPublicId);
          if (idx < 0) return m;
          const replaced: ChatMessage = { ...m[idx], content: newContent.trim() };
          return [...m.slice(0, idx), replaced];
        });
        // 追加 assistant 占位。
        const assistantIdx = (() => {
          let idx = -1;
          setMessages((m) => {
            idx = m.length;
            return [...m, { role: "assistant" as const, content: "" }];
          });
          return idx;
        })();

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            model,
            messages: result.messages.map((m) => ({ role: m.role, content: m.content })),
            parentPublicId: result.parentPublicId,
            sourcePublicId: userPublicId,
            branchReason: "edit",
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error("请求失败");

        await consumeChatSSE(res.body, {
          onDelta: (t) => appendToMessage(assistantIdx, t),
          onReasoning: (t) => appendReasoning(assistantIdx, t),
        });
      } catch (err) {
        const { content } = handleStreamError(err, "网络错误");
        if (!content.includes("[错误]")) {
          console.error("editAndResend failed:", err);
        }
      } finally {
        setStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [conversationId, streaming, appendToMessage, appendReasoning],
  );

  /**
   * 切换某条 assistant 消息的版本(同级兄弟)。
   * 查询同 parentId 的兄弟,切换到上/下一个,替换当前消息内容 + reasoning。
   * 切换后截断该消息之后的内容(以新版本为起点)。
   */
  const switchVersion = useCallback(
    async (publicId: string, direction: "prev" | "next") => {
      if (streaming || !publicId) return;
      try {
        const { siblings } = await getMessageSiblings(publicId);
        if (siblings.length <= 1) return;
        const curIdx = siblings.findIndex((s) => s.publicId === publicId);
        if (curIdx < 0) return;
        const nextIdx =
          direction === "prev"
            ? (curIdx - 1 + siblings.length) % siblings.length
            : (curIdx + 1) % siblings.length;
        const target = siblings[nextIdx];

        setMessages((m) => {
          const idx = m.findIndex((x) => x.publicId === publicId);
          if (idx < 0) return m;
          const replaced: ChatMessage = {
            ...m[idx],
            publicId: target.publicId,
            content: target.content,
            reasoning: target.reasoning ?? undefined,
            // 切换版本后清除该消息的 artifacts/trace/toolCalls(避免与旧版本混用)
            artifacts: undefined,
            trace: undefined,
            toolCalls: undefined,
            searchResults: undefined,
            versionInfo: { current: nextIdx + 1, total: siblings.length },
          };
          // 截断该消息之后的内容(以新版本为起点)
          return [...m.slice(0, idx), replaced];
        });
      } catch (err) {
        console.error("switchVersion failed:", err);
      }
    },
    [streaming],
  );

  /**
   * 加载某条消息的版本信息(供 UI 显示 ‹ n/total ›)。
   */
  const refreshVersionInfo = useCallback(
    async (publicId: string) => {
      try {
        const { siblings } = await getMessageSiblings(publicId);
        if (siblings.length <= 1) return;
        const curIdx = siblings.findIndex((s) => s.publicId === publicId);
        if (curIdx < 0) return;
        setMessages((m) =>
          m.map((x) =>
            x.publicId === publicId
              ? { ...x, versionInfo: { current: curIdx + 1, total: siblings.length } }
              : x,
          ),
        );
      } catch {
        /* 忽略 */
      }
    },
    [],
  );

  return {
    messages,
    streaming,
    conversationId,
    send,
    regenerate,
    editAndResend,
    switchVersion,
    refreshVersionInfo,
    stopGeneration,
  };
}
