"use client";
import { useState } from "react";
import { Send, Paperclip, Loader2, Sparkles, RefreshCw, Cpu, User } from "lucide-react";
import { clsx } from "clsx";
import { ArtifactPanel, type Artifact } from "@/components/artifacts/ArtifactPanel";
import { ArtifactInline } from "@/components/artifacts/ArtifactInline";
import { Markdown } from "@/shared/components/markdown/Markdown";
import { useChatRuntime } from "@/features/chat/hooks/useChatRuntime";
import { useChatAttachments } from "@/features/chat/hooks/useChatAttachments";
import { useChatScrollController } from "@/features/chat/hooks/useChatScrollController";
import type { ChatMessage, ModelOption } from "@/features/chat/model/types";

export type { ChatMessage, ModelOption } from "@/features/chat/model/types";

interface ChatComposerProps {
  models: ModelOption[];
  conversationId?: string;
  initialMessages?: ChatMessage[];
}

/**
 * ChatComposer —— 纯编排 + 渲染层。
 *
 * 业务逻辑已抽离到三个 hook(见 hooks/):
 *   - useChatRuntime        消息状态 / 发送 / 重新生成 / 停止
 *   - useChatAttachments    附件上传 / 粘贴 / 拖拽
 *   - useChatScrollController 自动滚动
 *
 * 本组件只负责:state 装配(model/input)、UI 渲染、事件绑定。
 */
export default function ChatComposer({
  models,
  conversationId: initialConvId,
  initialMessages = [],
}: ChatComposerProps) {
  // 内部 state 存 name(对外 ID),保证 API 调用稳定;UI 渲染时再映射到 displayName
  const [model, setModel] = useState(models[0]?.name ?? "");
  const [input, setInput] = useState("");
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);

  const attachments = useChatAttachments(initialConvId ?? null);
  const runtime = useChatRuntime({
    initialConversationId: initialConvId ?? null,
    initialMessages,
    uploadAttachments: attachments.uploadPending,
  });
  const messagesEndRef = useChatScrollController(runtime.messages);

  const handleSend = () => {
    runtime.send(input, model);
    setInput("");
  };

  if (models.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 p-8">
        <div className="text-center space-y-2 max-w-sm">
          <Cpu className="w-8 h-8 mx-auto text-neutral-300 dark:text-neutral-700 animate-pulse" />
          <h3 className="text-sm font-semibold">暂无可用模型</h3>
          <p className="text-xs text-neutral-450 dark:text-neutral-500 leading-relaxed">
            请联系系统管理员配置上游 Provider 资源，或在用户控制面板自行添加 BYO 独享模型。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full bg-[#fcfdff] dark:bg-[#0d0f14] transition-colors duration-250">
      {/* 主区:消息 + 输入(可被 artifact 面板挤压) */}
      <div className={clsx("flex flex-col h-full", activeArtifact && "flex-1 lg:flex-[3] lg:border-r lg:border-morning-mist lg:dark:border-deep-space/80")}>
      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-6 py-8 md:py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          {runtime.messages.length === 0 && (
            <div className="text-center py-24 md:py-32 space-y-4 animate-in fade-in duration-300">
              <div className="w-12 h-12 rounded-full bg-blue-500/[0.04] dark:bg-blue-500/[0.02] border border-blue-500/20 flex items-center justify-center mx-auto">
                <Sparkles className="w-5 h-5 text-blue-500" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-bold text-neutral-800 dark:text-white">欢迎来到 Nekusora 调试工作台</h2>
                <p className="text-xs text-neutral-450 dark:text-neutral-500 max-w-[280px] mx-auto leading-relaxed">
                  大呼吸感流式对话排版，已载入个性化记忆。请选择模型开始您的提问。
                </p>
              </div>
            </div>
          )}

          {runtime.messages.map((m, i) => (
            <div key={i} className={clsx("flex gap-4", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "assistant" && (
                <div className="w-7 h-7 rounded-full border border-blue-500/10 bg-blue-500/[0.04] flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                </div>
              )}

              <div className={clsx("max-w-[82%] space-y-2", m.role === "user" ? "flex flex-col items-end" : "")}>
                {m.role === "user" ? (
                  // 用户消息:纯文本气泡(不渲染 markdown,防注入)
                  <div className="rounded-2xl bg-neutral-900 text-white px-4 py-2.5 dark:bg-white dark:text-black shadow-none border border-transparent text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {m.content}
                  </div>
                ) : (
                  // assistant 消息:流式 markdown 渲染(代码块/表格/公式/列表)
                  <div className="text-neutral-800 dark:text-neutral-200 max-w-[75ch] text-sm leading-relaxed">
                    {m.content ? (
                      <Markdown
                        content={m.content}
                        isStreaming={runtime.streaming && i === runtime.messages.length - 1}
                      />
                    ) : runtime.streaming && i === runtime.messages.length - 1 ? (
                      <span className="inline-flex items-center gap-1.5 text-neutral-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        思考中…
                      </span>
                    ) : null}
                  </div>
                )}

                {m.role === "assistant" && m.publicId && !runtime.streaming && (
                  <button
                    onClick={() => runtime.regenerate(m.publicId!, model)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>重新生成</span>
                  </button>
                )}

                {m.role === "assistant" && m.artifacts && m.artifacts.length > 0 && (
                  <ArtifactInline
                    artifacts={m.artifacts}
                    onOpenPanel={setActiveArtifact}
                  />
                )}

                {m.role === "assistant" && m.trace && (
                  <details className="text-[11px] text-neutral-400 border border-morning-mist dark:border-deep-space/80 rounded-md bg-neutral-50/30 dark:bg-[#0d0f14]/10 overflow-hidden max-w-[75ch]">
                    <summary className="cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300 px-3 py-1.5 font-mono select-none flex items-center gap-1">
                      <span>🔍 路由链路追踪 ({m.trace.sentMessageCount ?? 0} 条上下文 · {m.trace.totalTokenEstimate ?? 0} tokens 消耗)</span>
                    </summary>
                    <div className="px-3 pb-2 pt-0.5 space-y-1 font-mono text-[10px] text-neutral-450 dark:text-neutral-500 border-t border-morning-mist dark:border-deep-space/60 mt-1">
                      {m.trace.blocks?.map((b, bi) => (
                        <div key={bi} className="flex justify-between gap-4">
                          <span>
                            <span className="text-neutral-400 dark:text-neutral-600">[{b.kind}]</span> {b.title}
                          </span>
                          <span className="font-semibold text-neutral-500">~{b.tokenEstimate}t</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              {m.role === "user" && (
                <div className="w-7 h-7 rounded-full border border-morning-mist dark:border-deep-space bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Control Box */}
      <div className="border-t border-morning-mist dark:border-deep-space/80 p-4 md:p-6 bg-[#fcfdff] dark:bg-[#0d0f14] sticky bottom-0 z-10">
        <div className="max-w-3xl mx-auto space-y-3.5">
          {/* File Attachments & Model Selector */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-[#0f121a] px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-200 focus:outline-none focus:border-sora-blue dark:focus:border-sora-blue transition-colors cursor-pointer"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.displayName ?? m.name}
                </option>
              ))}
            </select>

            <input
              ref={attachments.fileInputRef}
              type="file"
              multiple
              onChange={(e) => attachments.handleUpload(e.target.files)}
              className="hidden"
              id="file-upload"
            />

            <label
              htmlFor="file-upload"
              className="inline-flex items-center gap-1 rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-[#0f121a] px-3 py-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-all duration-150"
              title="选择文件上传"
            >
              <Paperclip className="w-3.5 h-3.5 text-neutral-400" />
              <span>上传附件</span>
            </label>

            {attachments.attached.map((a) => (
              <span
                key={a.id}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  a.status === "uploaded" && "bg-sora-blue/[0.04] border-sora-blue/20 text-sora-blue",
                  a.status === "uploading" && "bg-neutral-100 dark:bg-neutral-900 border-morning-mist dark:border-deep-space text-neutral-500",
                  a.status === "pending" && "bg-neku-amber/[0.04] border-neku-amber/20 text-neku-amber",
                  a.status === "error" && "bg-red-500/[0.04] border-red-500/20 text-red-500"
                )}
              >
                {a.status === "uploading" ? (
                  <Loader2 className="w-3 h-3 text-neutral-400 animate-spin" />
                ) : a.isImage && a.previewUrl ? (
                  // 图片附件显示缩略图预览
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.previewUrl}
                    alt={a.filename}
                    className="w-4 h-4 rounded-sm object-cover shrink-0"
                  />
                ) : (
                  <Paperclip className={clsx(
                    "w-3 h-3",
                    a.status === "uploaded" && "text-sora-blue",
                    a.status === "pending" && "text-neku-amber",
                    a.status === "error" && "text-red-500"
                  )} />
                )}

                <span className="max-w-[120px] truncate" title={a.filename}>
                  {a.filename}
                  {a.status === "pending" && " (待上传)"}
                  {a.status === "uploading" && " (上传中...)"}
                  {a.status === "error" && " (失败)"}
                </span>

                <button
                  onClick={() => attachments.removeAttachment(a.id)}
                  className="hover:opacity-75 font-semibold p-0.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-850 transition-colors"
                  title="移除"
                >
                  <X className="w-3 h-3 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300" />
                </button>
              </span>
            ))}
          </div>

          {/* Prompt input field */}
          <div className="flex gap-3 items-end bg-white dark:bg-[#0f121a] border border-morning-mist dark:border-deep-space rounded-xl p-2.5 focus-within:border-sora-blue dark:focus-within:border-sora-blue transition-all duration-150">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                // 粘贴图片直接作为附件上传。
                const items = e.clipboardData?.items;
                if (!items) return;
                const imageFiles: File[] = [];
                for (const item of items) {
                  if (item.kind === "file" && item.type.startsWith("image/")) {
                    const f = item.getAsFile();
                    if (f) imageFiles.push(f);
                  }
                }
                if (imageFiles.length > 0) {
                  e.preventDefault();
                  attachments.handleUpload(imageFiles);
                }
              }}
              onDrop={(e) => {
                // 拖拽图片/文件作为附件。
                const dropped = e.dataTransfer?.files;
                if (dropped && dropped.length > 0) {
                  e.preventDefault();
                  attachments.handleUpload(dropped);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="发送消息，按 Enter 发送，Shift + Enter 换行..."
              rows={2}
              className="flex-1 bg-transparent border-0 outline-none text-sm resize-none focus:ring-0 text-neutral-800 dark:text-neutral-200 py-1.5 px-2.5 leading-relaxed placeholder-neutral-400"
              disabled={runtime.streaming}
            />

            {runtime.streaming ? (
              <button
                onClick={runtime.stopGeneration}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-red-500 hover:bg-red-600 text-white hover:shadow-[0_4px_12px_rgba(239,68,68,0.15)] transition-all duration-200 shrink-0 shadow-none cursor-pointer"
                title="停止生成"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <rect x="5" y="5" width="14" height="14" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-sora-blue hover:bg-sora-blue-hover text-white hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] disabled:opacity-40 disabled:hover:shadow-none transition-all duration-200 shrink-0 shadow-none cursor-pointer"
                title="发送消息"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
      {/* Artifact 面板(右侧,可关闭) */}
      {activeArtifact && (
        <div className="hidden lg:flex lg:flex-[2] h-full">
          <ArtifactPanel
            artifact={activeArtifact}
            onClose={() => setActiveArtifact(null)}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}

// Small helper close button
function X(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={props.className}
      {...props}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
