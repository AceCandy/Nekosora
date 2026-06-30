"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { useChatStreamStore, NEW_CONVERSATION_KEY, type SendOptions } from "@/features/chat/store/chatStreamStore";
import type { ChatMessage } from "@/features/chat/model/types";

// 稳定的空消息数组:selector 在会话无数据时返回它(而非每次新建 [] 字面量),
// 避免 zustand 因引用变化误判、触发 React 无限重渲染。
const EMPTY_MESSAGES: ChatMessage[] = [];

interface UseChatRuntimeOptions {
  /** 当前会话 ID(来自路由;新会话为 null/undefined)。 */
  conversationId?: string | null;
  /** SSR 初始消息(仅当 store 内无该会话数据时注入)。 */
  initialMessages?: ChatMessage[];
  /** 发送前上传附件,返回 fileId 数组(由 useChatAttachments 提供)。 */
  uploadAttachments?: (convId: string) => Promise<string[]>;
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

  // 订阅该会话切片(messages / streaming)
  const messages = useChatStreamStore((s) => s.runtimes[key]?.messages ?? EMPTY_MESSAGES);
  const streaming = useChatStreamStore((s) => s.runtimes[key]?.streaming ?? false);

  // 前台会话的生成状态变化时刷新侧栏。开始时 refresh(此时 DB generating 已被
  // /api/chat 置 true),结束时也 refresh(清掉转圈)。仅当前路由对应的会话触发即可:
  // refresh 会重跑共享 layout 的 listConversations,所有会话的 generating 同步更新。
  const prevStreamingRef = useRef(streaming);
  useEffect(() => {
    if (prevStreamingRef.current !== streaming) {
      prevStreamingRef.current = streaming;
      // 流结束时 DB generating 已清,立即刷新;流开始时略延迟等 /api/chat 落库 generating=true
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
      switchVersion: s.switchVersion,
      refreshVersionInfo: s.refreshVersionInfo,
      stopGeneration: s.stopGeneration,
    })),
  );

  const send = useMemo(
    () =>
      (
        text: string,
        model: string,
        instructionCardIds?: string[],
        webSearch?: boolean,
        knowledgeBaseIds?: string[],
        createOptions?: { outputModeId?: string | null },
      ) => {
        const opts: SendOptions = { model, instructionCardIds, webSearch, knowledgeBaseIds, createOptions };
        void actions.send(key, text, opts, {
          uploadAttachments,
          onTitleUpdated: () => router.refresh(),
          // 新建会话首条回复结束后同步 URL,使「新对话」按钮不再失效(放流结束后避免中途路由段变化打断流)
          onConversationCreated: (newConvId) => router.replace(`/chat/${newConvId}`),
        });
      },
    [actions, key, uploadAttachments, router],
  );

  const regenerate = useMemo(
    () => (assistantPublicId: string, model: string) => {
      void actions.regenerate(key, assistantPublicId, model);
    },
    [actions, key],
  );

  const editAndResend = useMemo(
    () => (userPublicId: string, newContent: string, model: string) => {
      void actions.editAndResend(key, userPublicId, newContent, model);
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
    switchVersion,
    refreshVersionInfo,
    stopGeneration,
  };
}
