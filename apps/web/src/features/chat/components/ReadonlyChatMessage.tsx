"use client";

import { clsx } from "clsx";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { Markdown } from "@/shared/components/markdown/Markdown";
import type { MessageRunMetadata } from "@/features/chat/model/types";
import { RunMetadataFields } from "./RunMetadataFields";
import { ASSISTANT_MESSAGE_CLASS, splitChatError, USER_MESSAGE_BUBBLE_CLASS } from "./messagePresentation";

interface ReadonlyChatMessageProps {
  role: string;
  content: string;
  renderStyleClass?: string;
  renderer?: "streamdown" | "custom";
  runMetadata?: MessageRunMetadata;
}

/** Chat 默认正文外观的只读投影，不携带任何登录态消息操作。 */
export function ReadonlyChatMessage({ role, content, renderStyleClass, renderer, runMetadata }: ReadonlyChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex w-full max-w-[82%] flex-col items-end">
          <div className={USER_MESSAGE_BUBBLE_CLASS}>{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/shared-message">
      <div className={clsx(ASSISTANT_MESSAGE_CLASS, renderStyleClass && `rs-${renderStyleClass}`)}>
        {(() => {
          const { body, error } = splitChatError(content);
          return (
            <>
              {body && (
                <ErrorBoundary name="shared-message-markdown" rawContent={body}>
                  <Markdown
                    content={body}
                    isStreaming={false}
                    renderer={renderer}
                    renderStyleClass={renderStyleClass}
                  />
                </ErrorBoundary>
              )}
              {error && <p className="mt-2 text-ui-caption leading-5 text-danger ">{error}</p>}
            </>
          );
        })()}
      </div>
      {runMetadata && (
        <RunMetadataFields
          metadata={runMetadata}
          className="mt-3 justify-start opacity-0 transition-opacity duration-150 group-hover/shared-message:opacity-100 group-focus-within/shared-message:opacity-100 [@media(pointer:coarse)]:opacity-100 motion-reduce:transition-none"
        />
      )}
    </div>
  );
}
