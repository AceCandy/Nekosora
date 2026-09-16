import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/features/chat/model/types";
import type { PreviewableFile } from "@/shared/components/file-preview/FilePreviewModal";

const capturedItems = vi.hoisted(() => [] as Array<{
  message: ChatMessage;
  renderStyleClass?: string | null;
  renderStyleRenderer?: "streamdown" | "custom";
  isPaper?: boolean;
  onPreviewFile?: (file: PreviewableFile) => void;
}>);

const selectionTest = vi.hoisted(() => ({ active: false, injected: false }));
let capturedTree: React.ReactNode;
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const state = actual.useState(initial);
      if (initial !== null || !selectionTest.active || selectionTest.injected) return state;
      selectionTest.injected = true;
      return [{ text: "选中的正文", top: 100, left: 100 }, state[1]];
    },
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@shadcn/react/message-scroller", () => ({
  MessageScroller: {
    Provider: ({ children }: { children: React.ReactNode }) => {
      capturedTree = children;
      return children;
    },
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
  selectionTest.active = false;
  selectionTest.injected = false;
});
afterEach(() => vi.unstubAllGlobals());

describe("ChatMessageList render style boundary", () => {
  it("clears the source selection before the follow-up callback moves the input caret", () => {
    selectionTest.active = true;
    const calls: string[] = [];
    vi.stubGlobal("window", { getSelection: () => ({ removeAllRanges: () => calls.push("clear") }) });
    renderToStaticMarkup(<ChatMessageList
      messages={[]}
      streaming={false}
      model="model-a"
      onRegenerate={() => undefined}
      onOpenArtifact={() => undefined}
      onAsk={(text) => calls.push(text)}
    />);
    const collect = (node: React.ReactNode): React.ReactElement<{ children?: React.ReactNode; title?: string; onClick?: () => void }>[] => {
      if (!React.isValidElement<{ children?: React.ReactNode; title?: string; onClick?: () => void }>(node)) return [];
      return [node, ...React.Children.toArray(node.props.children).flatMap(collect)];
    };
    const button = collect(capturedTree).find((node) => node.props.title === "askFollowup");
    expect(button).toBeDefined();
    button?.props.onClick?.();
    expect(calls).toEqual(["clear", "选中的正文"]);
  });

  it("scopes CSS per assistant and keeps all style props away from user messages", () => {
    const onPreviewFile = vi.fn();
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
        onPreviewFile={onPreviewFile}
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
    expect(capturedItems.every((item) => item.onPreviewFile === onPreviewFile)).toBe(true);
  });
});
