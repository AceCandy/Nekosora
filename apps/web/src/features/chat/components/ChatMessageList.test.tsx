import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/features/chat/model/types";

const capturedItems = vi.hoisted(() => [] as Array<{
  message: ChatMessage;
  renderStyleClass?: string | null;
  renderStyleRenderer?: "streamdown" | "custom";
  isPaper?: boolean;
}>);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@shadcn/react/message-scroller", () => ({
  MessageScroller: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
    Root: ({ children }: { children: React.ReactNode }) => children,
    Viewport: ({ children }: { children: React.ReactNode }) => children,
    Content: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Item: ({ children }: { children: React.ReactNode }) => children,
    Button: () => null,
  },
  useMessageScroller: () => ({
    scrollToEnd: vi.fn(),
    scrollToMessage: vi.fn(),
    scrollToStart: vi.fn(),
  }),
  useMessageScrollerVisibility: () => ({
    currentAnchorId: null,
    visibleMessageIds: [],
  }),
}));

vi.mock("@/features/chat/components/ChatMessageItem", () => ({
  ChatMessageItem: (props: (typeof capturedItems)[number]) => {
    capturedItems.push(props);
    return (
      <div className={props.renderStyleClass ? `rs-${props.renderStyleClass}` : undefined}>
        {props.message.role}
      </div>
    );
  },
}));

vi.mock("@/features/chat/components/ChatOutline", () => ({ ChatOutline: () => null }));
vi.mock("@/features/chat/components/MessageTimeSeparator", () => ({ MessageTimeSeparator: () => null }));
vi.mock("@/shared/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/shared/ui/ConfirmDialog", () => ({ default: () => null }));
vi.mock("@/features/chat/hooks/useMessageSpeech", () => ({
  useMessageSpeech: () => ({ supported: false, speakingId: null, speak: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@/shared/lib/clipboard", () => ({ copyToClipboard: vi.fn() }));

import { ChatMessageList } from "./ChatMessageList";

beforeEach(() => {
  capturedItems.length = 0;
});

describe("ChatMessageList render style boundary", () => {
  it("scopes CSS per assistant and keeps all style props away from user messages", () => {
    const html = renderToStaticMarkup(
      <ChatMessageList
        messages={[
          { role: "user", content: "Question", publicId: "user-1" },
          { role: "assistant", content: "Answer", publicId: "assistant-1" },
          { role: "assistant", content: "More", publicId: "assistant-2" },
        ]}
        streaming={false}
        model="model-a"
        renderStyleClass="paper"
        renderStyleRenderer="custom"
        isPaper
        onRegenerate={() => undefined}
        onOpenArtifact={() => undefined}
      />,
    );

    expect(html.match(/rs-paper/g)).toHaveLength(2);
    expect(capturedItems).toHaveLength(3);
    expect(capturedItems[0]).toMatchObject({
      message: expect.objectContaining({ role: "user" }),
      renderStyleClass: undefined,
      renderStyleRenderer: undefined,
      isPaper: undefined,
    });
    expect(capturedItems[1]).toMatchObject({
      message: expect.objectContaining({ role: "assistant" }),
      renderStyleClass: "paper",
      renderStyleRenderer: "custom",
      isPaper: true,
    });
    expect(capturedItems[2]).toMatchObject({
      message: expect.objectContaining({ role: "assistant" }),
      renderStyleClass: "paper",
      renderStyleRenderer: "custom",
      isPaper: true,
    });
  });
});
