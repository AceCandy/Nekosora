"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ChatMessageAttachment,
  UploadFileItem,
} from "@/features/chat/model/types";

/**
 * 聊天附件管理 —— 封装附件 state + 上传逻辑 + 粘贴/拖拽入口。
 *
 * 职责:
 *   - 维护 attached 列表(本地预览 + 上传状态)
 *   - handleUpload:接收 FileList/File[],立即上传(若已有 conversationId)或标 pending(等发送时上传)
 *   - removeAttachment:移除单项
 *   - uploadPending:发送消息时等待全部附件上传,返回消息附件 DTO
 *
 * 上传端点:/api/upload(FormData:file, conversationId)
 * 文件来源包括文件选择、粘贴与拖拽。
 */
export function useChatAttachments(conversationId: string | null) {
  const t = useTranslations("chat");
  const [attached, setAttached] = useState<UploadFileItem[]>([]);
  const previewUrlsRef = useRef(new Set<string>());
  const uploadTasksRef = useRef(new Map<string, Promise<string | null>>());

  useEffect(() => {
    const activeUrls = new Set(
      attached.flatMap((item) => (item.previewUrl ? [item.previewUrl] : [])),
    );
    previewUrlsRef.current.forEach((url) => {
      if (!activeUrls.has(url)) {
        URL.revokeObjectURL(url);
        previewUrlsRef.current.delete(url);
      }
    });
  }, [attached]);

  useEffect(
    () => () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    },
    [],
  );

  const uploadOne = useCallback(
    async (item: UploadFileItem, targetConvId: string): Promise<string | null> => {
      const fd = new FormData();
      if (!item.file) return null;
      fd.append("file", item.file);
      fd.append("conversationId", targetConvId);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (res.ok) {
          const data = (await res.json()) as { fileId: string; filename: string; status: string };
          setAttached((prev) =>
            prev.map((x) =>
              x.id === item.id ? { ...x, fileId: data.fileId, status: "uploaded" } : x,
            ),
          );
          return data.fileId;
        }
        setAttached((prev) =>
          prev.map((x) => (x.id === item.id ? { ...x, status: "error" } : x)),
        );
      } catch {
        setAttached((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: "error" } : x)));
      }
      return null;
    },
    [],
  );

  const handleUpload = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || (files as FileList).length === 0) return;

      const newItems: UploadFileItem[] = Array.from(files).map((file) => {
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        if (previewUrl) previewUrlsRef.current.add(previewUrl);
        return {
          id: Math.random().toString(36).substring(7),
          filename: file.name,
          mime: file.type || "application/octet-stream",
          file,
          status: conversationId ? "uploading" : "pending",
          isImage: file.type.startsWith("image/"),
          previewUrl,
        };
      });

      setAttached((prev) => [...prev, ...newItems]);

      if (conversationId) {
        for (const item of newItems) {
          const task = uploadOne(item, conversationId);
          uploadTasksRef.current.set(item.id, task);
          void task.then((fileId) => {
            if (!fileId) uploadTasksRef.current.delete(item.id);
          });
        }
      }
    },
    [conversationId, uploadOne],
  );

  /** 发送消息时等待整批附件；任一失败则整轮失败，不返回成功子集。 */
  const uploadPending = useCallback(
    async (targetConvId: string): Promise<ChatMessageAttachment[]> => {
      const resolveItem = async (item: UploadFileItem): Promise<ChatMessageAttachment> => {
        let fileId = item.status === "uploaded" ? item.fileId : undefined;
        if (!fileId) {
          setAttached((prev) =>
            prev.map((candidate) =>
              candidate.id === item.id ? { ...candidate, status: "uploading" } : candidate,
            ),
          );
          let task = uploadTasksRef.current.get(item.id);
          if (!task) {
            task = uploadOne(item, targetConvId);
            uploadTasksRef.current.set(item.id, task);
          }
          fileId = (await task) ?? undefined;
          if (!fileId) {
            uploadTasksRef.current.delete(item.id);
            throw new Error(t("attachmentUploadFailed"));
          }
        }
        return {
          fileId,
          filename: item.filename,
          mime: item.mime || item.file?.type || "application/octet-stream",
        };
      };

      try {
        return await Promise.all(attached.map(resolveItem));
      } catch (error) {
        throw error instanceof Error ? error : new Error(t("attachmentUploadFailed"));
      }
    },
    [attached, t, uploadOne],
  );

  const removeAttachment = useCallback((id: string) => {
    uploadTasksRef.current.delete(id);
    setAttached((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearConsumedAttachments = useCallback((fileIds: string[]) => {
    const consumedIds = new Set(fileIds);
    for (const [itemId, task] of uploadTasksRef.current) {
      void task.then((fileId) => {
        if (fileId && consumedIds.has(fileId)) uploadTasksRef.current.delete(itemId);
      });
    }
    setAttached((prev) =>
      prev.filter((item) => {
        const consumed =
          item.status === "uploaded" &&
          item.fileId !== undefined &&
          consumedIds.has(item.fileId);
        return !consumed;
      }),
    );
  }, []);

  return {
    attached,
    handleUpload,
    uploadPending,
    removeAttachment,
    clearConsumedAttachments,
  };
}
