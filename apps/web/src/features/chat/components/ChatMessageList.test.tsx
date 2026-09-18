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
const motionTest = vi.hoisted(() => ({
  active: false,
  entryRef: null as { current: { conversationId?: string; messageCount: number } } | null,
  effects: [] as React.EffectCallback[],
}));
let capturedTree: React.ReactNode;
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const ref = actual.useRef(initial);
      if (!motionTest.active || !initial || typeof initial !== "object" || !("messageCount" in initial)) return ref;
      motionTest.entryRef ??= ref as NonNullable<typeof motionTest.entryRef>;
      return motionTest.entryRef;
    },
    useLayoutEffect: (effect: React.EffectCallback, deps?: React.DependencyList) => {
      actual.useLayoutEffect(effect, deps);
      if (motionTest.active) motionTest.effects.push(effect);
    },
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
    Item: ({ children, className, messageId }: { children: React.ReactNode; className?: string; messageId: string }) => (
      <div className={className} data-message-id={messageId}>{children}</div>
    ),
    Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
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
  motionTest.active = false;
  motionTest.entryRef = null;
  motionTest.effects = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("ChatMessageList render style boundary", () => {
  it("groups question/answer spacing and leaves the latest arrow still", () => {
    const html = renderToStaticMarkup(<ChatMessageList
      messages={[{ role: "user", content: "Q" }, { role: "assistant", content: "A" }, { role: "user", content: "Q2" }]}
      streaming={false} model="model-a" onRegenerate={vi.fn()} onOpenArtifact={vi.fn()}
    />);
    expect(html).toContain('class="pb-3 pt-4" data-message-id="msg-0"');
    expect(html).toContain('class="pb-3 pt-3" data-message-id="msg-1"');
    expect(html).toContain('class="pb-3 pt-8" data-message-id="msg-2"');
    expect(html).not.toContain("infinite");
  });

  it("animates only appended live rows, not history, ID backfill, versions or reduced motion", () => {
    motionTest.active = true;
    const animate = vi.fn();
    const querySelector = vi.fn((_selector: string) => ({ animate }));
    let reduced = false;
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });
    const render = (messages: ChatMessage[], streaming: boolean, conversationId?: string) => {
      motionTest.effects = [];
      renderToStaticMarkup(<ChatMessageList messages={messages} streaming={streaming} conversationId={conversationId}
        model="model-a" onRegenerate={vi.fn()} onOpenArtifact={vi.fn()} />);
      const root = capturedTree as React.ReactElement<{ children: React.ReactNode }>;
      const viewport = React.Children.toArray(root.props.children).find((node) =>
        React.isValidElement<{ preserveScrollOnPrepend?: boolean }>(node) && node.props.preserveScrollOnPrepend,
      ) as React.ReactElement<{ ref: React.RefObject<unknown> }>;
      viewport.props.ref.current = { querySelector };
      motionTest.effects[0]();
    };
    const pair: ChatMessage[] = [{ role: "user", content: "Q" }, { role: "assistant", content: "" }];
    render([], false);
    render(pair, true, "created-id");
    expect(animate).toHaveBeenCalledTimes(2);
    expect(querySelector.mock.calls.map((call) => call[0])).toEqual([
      '[data-message-id="msg-0"]', '[data-message-id="msg-1"]',
    ]);
    render(pair.map((message, index) => ({ ...message, publicId: `id-${index}`, content: "updated" })), true, "created-id");
    expect(animate).toHaveBeenCalledTimes(2);
    render([...pair, ...pair], false, "created-id"); // 历史版本包含更多后续消息
    render([...pair, ...pair, ...pair], true, "another-id"); // 返回后台仍在生成的会话
    expect(animate).toHaveBeenCalledTimes(2);
    render(pair, false, "another-id"); // 删除/截断之后仍可发送新轮
    render([...pair, ...pair], true, "another-id");
    expect(animate).toHaveBeenCalledTimes(4);
    reduced = true;
    render([...pair, ...pair, ...pair], true, "another-id");
    expect(animate).toHaveBeenCalledTimes(4);
    motionTest.entryRef = null;
    reduced = false;
    render(pair, true, "another-id"); // 初次挂载的流式历史也不入场
    expect(animate).toHaveBeenCalledTimes(4);
  });

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
