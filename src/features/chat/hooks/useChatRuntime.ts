"use client";

import { useCallback, useRef, useState } from "react";
import { createConversation } from "@/features/chat/actions/conversations";
import { retryFromMessage } from "@/features/chat/actions/branch";
import { consumeChatSSE, handleStreamError } from "@/features/chat/model/sse";
import type { ChatMessage } from "@/features/chat/model/types";

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

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStreaming(false);
  }, []);

  const send = useCallback(
    async (text: string, model: string, instructionCardIds?: string[]) => {
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
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error("请求失败");

        await consumeChatSSE(res.body, {
          onDelta: (t) => appendToMessage(assistantIdx, t),
          onError: (err) => setMessageContent(assistantIdx, `[错误] ${err}`),
          onTrace: (trace) => mergeTrace(assistantIdx, trace),
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
    [messages, streaming, conversationId, uploadAttachments, appendToMessage, setMessageContent, mergeTrace],
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
    [conversationId, streaming, appendToMessage],
  );

  return {
    messages,
    streaming,
    conversationId,
    send,
    regenerate,
    stopGeneration,
  };
}
