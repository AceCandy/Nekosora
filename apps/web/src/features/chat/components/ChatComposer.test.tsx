import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReasoningLevel } from "@/db/types";
import type { ComposerSelectionState, ComposerTransition } from "@/features/chat/model/composerState";
import type { ModelOption } from "@/features/chat/model/types";

const mocks = vi.hoisted(() => ({
  adoptConversation: vi.fn(),
  dispatch: vi.fn(),
  retry: vi.fn(),
  send: vi.fn(),
}));

interface CapturedToolbarProps {
  onCardToggle: (id: string) => void;
  onKbToggle: (id: string) => void;
  onWebSearchToggle: () => void;
  onOutputModeToggle: (id: string) => void;
  onRenderStyleToggle: (id: string) => void;
  onModelChange: (id: string) => void;
  onReasoningChange: (reasoning: ReasoningLevel) => void;
}

interface CapturedInputBoxProps {
  onSend: () => void;
  topContent?: React.ReactNode;
}

interface CapturedMessageListProps {
  onAsk?: (text: string) => void;
}

interface CapturedRuntimeOptions {
  onConversationCreated?: (conversationId: string) => void;
}

let capturedToolbar: CapturedToolbarProps | null = null;
let capturedInputBox: CapturedInputBoxProps | null = null;
let capturedMessageList: CapturedMessageListProps | null = null;
let capturedRuntimeOptions: CapturedRuntimeOptions | null = null;
let coordinatorState: ComposerSelectionState;
let currentSnapshot: ComposerSelectionState;
let syncStatus: "idle" | "saving" | "error" = "idle";

vi.mock("next/image", () => ({
  default: () => React.createElement("span", { "data-image": "true" }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => ({
    composerSyncFailed: "输入区设置未同步",
    newConversation: "新对话",
    retry: "重试",
    welcomeTitle: "Nekusora",
  })[key] ?? key,
}));
vi.mock("@/features/artifacts/ArtifactPanel", () => ({
  ArtifactPanel: () => null,
}));
vi.mock("@/shared/components/file-preview/FilePreviewModal", () => ({
  default: () => null,
}));
vi.mock("@/features/chat/hooks/useChatAttachments", () => ({
  useChatAttachments: () => ({
    attached: [],
    handleUpload: vi.fn(),
    removeAttachment: vi.fn(),
    clearConsumedAttachments: vi.fn(),
    uploadPending: vi.fn(),
  }),
}));
vi.mock("@/features/chat/hooks/useChatRuntime", () => ({
  useChatRuntime: (options: CapturedRuntimeOptions) => {
    capturedRuntimeOptions = options;
    return {
      messages: [],
      streaming: false,
      send: mocks.send,
      regenerate: vi.fn(),
      editAndResend: vi.fn(),
      deleteMessage: vi.fn(),
      continueGeneration: vi.fn(),
      switchVersion: vi.fn(),
      setMessageFeedbackLocal: vi.fn(),
      stopGeneration: vi.fn(),
    };
  },
}));
vi.mock("@/features/chat/hooks/useComposerCoordinator", () => ({
  useComposerCoordinator: () => ({
    state: coordinatorState,
    syncStatus,
    dispatch: (transition: ComposerTransition) => mocks.dispatch(transition),
    getSnapshot: () => currentSnapshot,
    adoptConversation: mocks.adoptConversation,
    retry: mocks.retry,
  }),
}));
vi.mock("@/features/chat/components/ChatMessageList", () => ({
  ChatMessageList: (props: CapturedMessageListProps) => {
    capturedMessageList = props;
    return React.createElement("div", { "data-message-list": "true" });
  },
}));
vi.mock("@/features/chat/components/ChatToolbar", () => ({
  ChatToolbar: (props: CapturedToolbarProps) => {
    capturedToolbar = props;
    return React.createElement("div", { "data-toolbar": "true" });
  },
  ComposerPlusMenu: () => null,
  ModelControlMenu: () => null,
}));
vi.mock("@/features/chat/components/ChatInputBox", () => ({
  ChatInputBox: (props: CapturedInputBoxProps) => {
    capturedInputBox = props;
    return React.createElement("div", null, props.topContent);
  },
}));
vi.mock("@/features/chat/components/ChatHeader", () => ({ default: () => null }));
vi.mock("@/features/chat/store/chatStreamStore", () => ({
  useChatStreamStore: (selector: (state: { optimisticConversation: null }) => unknown) => selector({
    optimisticConversation: null,
  }),
}));
vi.mock("@/features/chat/actions/conversations", () => ({
  saveConversationComposerState: vi.fn(),
}));

import ChatComposer from "./ChatComposer";

const models: ModelOption[] = [
  {
    modelId: "model-a",
    name: "provider/model-a",
    capabilities: {
      reasoning: true,
      thinkingFormat: "openai",
      thinkingLevelMap: { off: "none", low: "low", high: "high" },
    },
  },
  { modelId: "model-b", name: "provider/model-b" },
];

const initialState: ComposerSelectionState = {
  modelId: "model-a",
  cardIds: ["card-initial"],
  kbIds: ["kb-initial"],
  webSearch: false,
  outputModeId: "mode-initial",
  renderStyleId: "style-initial",
  reasoningByModelId: { "model-a": "off" },
};

function collectElements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(collectElements)];
}

function renderComposer(conversationId?: string): string {
  return renderToStaticMarkup(
    <ChatComposer
      models={models}
      conversationId={conversationId}
      createShareAction={async () => { throw new Error("unused"); }}
      listSharesAction={async () => []}
      revokeShareAction={async () => undefined}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedToolbar = null;
  capturedInputBox = null;
  capturedMessageList = null;
  capturedRuntimeOptions = null;
  coordinatorState = {
    ...initialState,
    cardIds: [...initialState.cardIds],
    kbIds: [...initialState.kbIds],
    reasoningByModelId: { ...initialState.reasoningByModelId },
  };
  currentSnapshot = coordinatorState;
  syncStatus = "idle";
});

describe("ChatComposer coordinator integration", () => {
  it("routes every selection control through domain transitions", () => {
    renderComposer("conversation-a");

    capturedToolbar?.onCardToggle("card-b");
    capturedToolbar?.onKbToggle("kb-b");
    capturedToolbar?.onWebSearchToggle();
    capturedToolbar?.onOutputModeToggle("mode-b");
    capturedToolbar?.onRenderStyleToggle("style-b");
    capturedToolbar?.onModelChange("model-b");
    capturedToolbar?.onReasoningChange("high");

    expect(mocks.dispatch.mock.calls.map(([transition]) => transition)).toEqual([
      { type: "toggleCard", id: "card-b" },
      { type: "toggleKnowledgeBase", id: "kb-b" },
      { type: "toggleWebSearch" },
      { type: "selectOutputMode", id: "mode-b" },
      { type: "selectRenderStyle", id: "style-b" },
      { type: "selectModel", modelId: "model-b" },
      { type: "setModelReasoning", modelId: "model-a", reasoning: "high" },
    ]);
  });

  it("send and selection ask read the latest synchronous snapshot", () => {
    renderComposer("conversation-a");
    currentSnapshot = {
      ...coordinatorState,
      cardIds: ["card-latest"],
      kbIds: ["kb-latest"],
      webSearch: true,
      outputModeId: null,
      renderStyleId: "style-latest",
      reasoningByModelId: { "model-a": "high", "model-b": "off" },
    };

    capturedInputBox?.onSend();
    capturedMessageList?.onAsk?.("selected text");

    const expectedOptions = {
      outputModeId: null,
      renderStyleId: "style-latest",
      reasoning: "high",
      reasoningByModelId: { "model-a": "high", "model-b": "off" },
    };
    expect(mocks.send).toHaveBeenNthCalledWith(
      1,
      "",
      "provider/model-a",
      "model-a",
      ["card-latest"],
      true,
      ["kb-latest"],
      expectedOptions,
      expect.objectContaining({ onAccepted: expect.any(Function), onRejected: expect.any(Function) }),
    );
    expect(mocks.send).toHaveBeenNthCalledWith(
      2,
      "selected text",
      "provider/model-a",
      "model-a",
      ["card-latest"],
      true,
      ["kb-latest"],
      expectedOptions,
      undefined,
    );
  });

  it("adopts a new conversation with the exact snapshot used to create it", () => {
    renderComposer();
    const createSnapshot = currentSnapshot;

    capturedInputBox?.onSend();
    currentSnapshot = { ...currentSnapshot, cardIds: ["changed-during-create"] };
    capturedRuntimeOptions?.onConversationCreated?.("conversation-new");

    expect(mocks.adoptConversation).toHaveBeenCalledWith("conversation-new", createSnapshot);
  });

  it("renders an accessible unsynced state and retries through the coordinator", () => {
    syncStatus = "error";
    const html = renderComposer("conversation-a");

    expect(html).toContain('role="alert"');
    expect(html).toContain("输入区设置未同步");
    expect(html).toContain("重试");

    const retryButton = collectElements(capturedInputBox?.topContent).find((element) =>
      element.type === "button" && element.props.onClick === mocks.retry);
    (retryButton?.props.onClick as (() => void) | undefined)?.();
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});
