"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { useChatStreamStore, NEW_CONVERSATION_KEY, type SendOptions } from "@/features/chat/store/chatStreamStore";
import type { ChatMessage } from "@/features/chat/model/types";
import type { ReasoningLevel } from "@/db/types";

interface UseChatRuntimeOptions {
  /** 当前会话 ID(来自路由;新会话为 null/undefined)。 */
  conversationId?: string | null;
  /** SSR 初始消息(仅当 store 内无该会话数据时注入)。 */
  initialMessages?: ChatMessage[];
  /** 发送前上传附件,返回 fileId 数组(由 useChatAttachments 提供)。 */
  uploadAttachments?: (convId: string) => Promise<string[]>;
  /** 新会话建会后回调(用于上层更新活动会话 id);本 hook 会在此前静默替换 URL。 */
  onConversationCreated?: (newConvId: string) => void;
}

/**
 * 聊天运行时 React 适配层。
 *
 * 真正的状态与流式逻辑驻留在全局 chatStreamStore(支持多会话并行、切路由不断流)。
 * 此 hook 按 conversationId 订阅 store 切片,并把 SSR 初始消息注入 store(hydrate)。
 * 对外暴露的接口与单会话时期保持兼容,降低上层改动。
 */
export function useChatRuntime({
  conversationId = null,
  initialMessages = [],
  uploadAttachments,
  onConversationCreated,
}: UseChatRuntimeOptions = {}) {
  const router = useRouter();
  // 新会话用临时键隔离;已有会话用真实 id 作为键
  const key = conversationId ?? NEW_CONVERSATION_KEY;

  // 挂载/会话切换时注入 SSR 初始消息(store 已有数据则跳过,优先保留进行中的流式状态)
  useEffect(() => {
    useChatStreamStore.getState().hydrate(key, initialMessages);
    // 切到真实会话后,清掉新对话临时键残留(上一轮新建会话若未正常迁移会留下脏数据),
    // 确保下次点「新对话」进入的是干净空白页。新对话页本身(key=__new__)不清理。
    if (key !== NEW_CONVERSATION_KEY) {
      useChatStreamStore.getState().clear(NEW_CONVERSATION_KEY);
    }
    // 仅在会话 key 变化时注入 SSR 初始消息,不跟随 initialMessages 变化重复 hydrate
    // (避免流式进行中被新的 SSR 快照覆盖)。故依赖数组只含 key。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 订阅该会话切片(messages / streaming)。
  // messages:store 无该会话数据时(SSR / 首次加载尚未 hydrate)回落到 SSR 初始消息,
  // 避免刷新历史会话时先闪空态(欢迎页)、mount hydrate 后才出消息。
  const storeMessages = useChatStreamStore((s) => s.runtimes[key]?.messages);
  const messages = storeMessages ?? initialMessages;
  const streaming = useChatStreamStore((s) => s.runtimes[key]?.streaming ?? false);

  // 前台会话的生成状态变化时刷新侧栏。开始时 refresh(此时 DB generating 已被
  // /api/chat 置 true),结束时也 refresh(清掉转圈)。仅当前路由对应的会话触发即可:
  // refresh 会重跑共享 layout 的 listConversations,所有会话的 generating 同步更新。
  // 挂载时判定是否新会话页(initialConvId 为空)。replaceState 后 router.refresh 会跨 segment 重挂,
  // 故新会话场景跳过 refresh;侧栏高亮/新会话项/generating 改由 chatStreamStore 乐观驱动。
  const wasNewConversation = useRef(conversationId === null);
  const prevStreamingRef = useRef(streaming);
  useEffect(() => {
    if (prevStreamingRef.current !== streaming) {
      prevStreamingRef.current = streaming;
      if (wasNewConversation.current) return;
      // 历史会话页:URL 本就是 [id],同 segment refresh 安全,用于刷侧栏 generating。
      const timer = setTimeout(() => router.refresh(), streaming ? 400 : 0);
      return () => clearTimeout(timer);
    }
  }, [streaming, router]);

  // 用 useShallow 浅比较:actions 对象引用每次都不同,需按属性浅比较避免无限渲染
  const actions = useChatStreamStore(
    useShallow((s) => ({
      send: s.send,
      regenerate: s.regenerate,
      editAndResend: s.editAndResend,
      deleteMessage: s.deleteMessage,
      continueGeneration: s.continueGeneration,
      switchVersion: s.switchVersion,
      refreshVersionInfo: s.refreshVersionInfo,
      stopGeneration: s.stopGeneration,
    })),
  );

  const send = useMemo(
    () =>
      (
        text: string,
        modelName: string,
        modelId: string,
        instructionCardIds?: string[],
        webSearch?: boolean,
        knowledgeBaseIds?: string[],
        createOptions?: { outputModeId?: string | null; renderStyleId?: string | null; reasoning?: ReasoningLevel },
      ) => {
        const opts: SendOptions = { model: modelName, modelId, instructionCardIds, webSearch, knowledgeBaseIds, createOptions };
        void actions.send(key, text, opts, {
          uploadAttachments,
          onTitleUpdated: () => { if (!wasNewConversation.current) router.refresh(); },
          // 静默换 URL,不触发 Next.js RSC 导航(避免组件重挂、流式中断);同时通知上层更新活动会话 id。
          onConversationCreated: (newConvId) => {
            window.history.replaceState(null, "", `/chat/${newConvId}`);
            onConversationCreated?.(newConvId);
          },
        });
      },
    [actions, key, uploadAttachments, router, onConversationCreated],
  );

  const regenerate = useMemo(
    () => (assistantPublicId: string, modelName: string, modelId: string) => {
      void actions.regenerate(key, assistantPublicId, modelName, modelId);
    },
    [actions, key],
  );

  const editAndResend = useMemo(
    () => (userPublicId: string, newContent: string, modelName: string, modelId: string) => {
      void actions.editAndResend(key, userPublicId, newContent, modelName, modelId);
    },
    [actions, key],
  );

  const deleteMessage = useMemo(
    () => (publicId: string) => {
      void actions.deleteMessage(key, publicId);
    },
    [actions, key],
  );

  const continueGeneration = useMemo(
    () => (assistantPublicId: string, modelName: string, modelId: string) => {
      void actions.continueGeneration(key, assistantPublicId, modelName, modelId);
    },
    [actions, key],
  );

  const switchVersion = useMemo(
    () => (publicId: string, direction: "prev" | "next") => {
      void actions.switchVersion(key, publicId, direction);
    },
    [actions, key],
  );

  const refreshVersionInfo = useMemo(
    () => (publicId: string) => {
      void actions.refreshVersionInfo(key, publicId);
    },
    [actions, key],
  );

  const stopGeneration = useMemo(
    () => () => {
      actions.stopGeneration(key);
    },
    [actions, key],
  );

  return {
    messages,
    streaming,
    conversationId: conversationId ?? null,
    send,
    regenerate,
    editAndResend,
    deleteMessage,
    continueGeneration,
    switchVersion,
    refreshVersionInfo,
    stopGeneration,
  };
}
