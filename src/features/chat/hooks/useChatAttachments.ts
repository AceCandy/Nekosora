"use client";

import { useCallback, useState } from "react";
import type { UploadFileItem } from "@/features/chat/model/types";

/**
 * 聊天附件管理 —— 封装附件 state + 上传逻辑 + 粘贴/拖拽入口。
 *
 * 职责:
 *   - 维护 attached 列表(本地预览 + 上传状态)
 *   - handleUpload:接收 FileList/File[],立即上传(若已有 conversationId)或标 pending(等发送时上传)
 *   - removeAttachment:移除单项
 *   - uploadPending:发送消息时,把 pending 项上传,返回 fileId 数组
 *
 * 上传端点:/api/upload(FormData:file, conversationId)
 * 文件来源仅粘贴/拖拽,不再提供独立上传按钮。
 */
export function useChatAttachments(conversationId: string | null) {
  const [attached, setAttached] = useState<UploadFileItem[]>([]);

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

      const newItems: UploadFileItem[] = Array.from(files).map((file) => ({
        id: Math.random().toString(36).substring(7),
        filename: file.name,
        file,
        status: conversationId ? "uploading" : "pending",
        isImage: file.type.startsWith("image/"),
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      }));

      setAttached((prev) => [...prev, ...newItems]);

      if (conversationId) {
        for (const item of newItems) {
          await uploadOne(item, conversationId);
        }
      }
    },
    [conversationId, uploadOne],
  );

  /** 发送消息时,把 pending 项上传,返回所有 uploaded 的 fileId。 */
  const uploadPending = useCallback(
    async (targetConvId: string): Promise<string[]> => {
      const uploadedFileIds: string[] = attached
        .filter((a) => a.status === "uploaded" && a.fileId)
        .map((a) => a.fileId!);

      const pendingFiles = attached.filter((x) => x.status === "pending");
      if (pendingFiles.length > 0) {
        setAttached((prev) =>
          prev.map((x) => (x.status === "pending" ? { ...x, status: "uploading" } : x)),
        );
        for (const item of pendingFiles) {
          const fid = await uploadOne(item, targetConvId);
          if (fid) uploadedFileIds.push(fid);
        }
      }
      return uploadedFileIds;
    },
    [attached, uploadOne],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttached((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const resetAttachments = useCallback(() => {
    // 释放图片预览的 object URL,避免内存泄漏。
    setAttached((prev) => {
      prev.forEach((x) => {
        if (x.previewUrl) URL.revokeObjectURL(x.previewUrl);
      });
      return [];
    });
  }, []);

  return {
    attached,
    handleUpload,
    uploadPending,
    removeAttachment,
    resetAttachments,
  };
}
