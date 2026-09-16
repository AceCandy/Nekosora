import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReasoningLevel } from "@nekusora/db/types";
import type { ComposerSelectionState, ComposerTransition } from "@/features/chat/model/composerState";
import type { ModelOption, RenderStyleOption } from "@/features/chat/model/types";
import type { PreviewableFile } from "@/shared/components/file-preview/FilePreviewModal";

const mocks = vi.hoisted(() => ({
  adoptConversation: vi.fn(),
  dispatch: vi.fn(),
  retry: vi.fn(),
  send: vi.fn(),
  handleUpload: vi.fn(),
  translate: vi.fn<(key: string) => string>(),
  draft: null as string | null,
  queue: null as string[] | null,
  streaming: false,
  stopGeneration: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const state = actual.useState(initial);
      if (Array.isArray(initial) && mocks.queue !== null) {
        return [mocks.queue, (next: string[]) => { mocks.queue = next; }];
      }
      if (initial !== "" || mocks.draft === null) return state;
      return [mocks.draft, (next: React.SetStateAction<string>) => {
        mocks.draft = typeof next === "function" ? next(mocks.draft ?? "") : next;
      }];
    },
    useRef: (initial: unknown) => actual.useRef(Array.isArray(initial) && mocks.queue !== null ? mocks.queue : initial),
  };
});

interface CapturedToolbarProps {
  onUploadFiles: (files: FileList | File[] | null) => void;
  webSearchAvailable: boolean;
  onCardToggle: (id: string) => void;
  onKbToggle: (id: string) => void;
  onWebSearchToggle: () => void;
  onOutputModeToggle: (id: string) => void;
  onRenderStyleToggle: (id: string) => void;
  onModelChange: (id: string) => void;
  onReasoningChange: (reasoning: ReasoningLevel) => void;
  onPreviewFile: (file: PreviewableFile) => void;
}

interface CapturedInputBoxProps {
  onSend: () => void;
  topContent?: React.ReactNode;
  leadingControl?: React.ReactNode;
}

interface CapturedMessageListProps {
  onAsk?: (text: string) => void;
  renderStyleClass?: string | null;
  renderStyleRenderer?: "streamdown" | "custom";
  isPaper?: boolean;
  onPreviewFile?: (file: PreviewableFile) => void;
}

interface CapturedHeaderProps {
  title: string;
  conversationId?: string;
  renderStyleMenu?: React.ReactNode;
}

interface CapturedRuntimeOptions {
  onConversationCreated?: (conversationId: string) => void;
  onRequestRejected?: (reason: string) => void;
}

let capturedToolbar: CapturedToolbarProps | null = null;
let capturedInputBox: CapturedInputBoxProps | null = null;
let capturedMessageList: CapturedMessageListProps | null = null;
let capturedHeader: CapturedHeaderProps | null = null;
let capturedRuntimeOptions: CapturedRuntimeOptions | null = null;
let coordinatorState: ComposerSelectionState;
let currentSnapshot: ComposerSelectionState;
let syncStatus: "idle" | "saving" | "error" = "idle";
let capturedComposerTree: React.ReactNode;

vi.mock("next/image", () => ({
  default: () => React.createElement("span", { "data-image": "true" }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => mocks.translate,
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
    handleUpload: mocks.handleUpload,
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
      streaming: mocks.streaming,
      send: mocks.send,
      regenerate: vi.fn(),
      editAndResend: vi.fn(),
      deleteMessage: vi.fn(),
      continueGeneration: vi.fn(),
      switchVersion: vi.fn(),
      setMessageFeedbackLocal: vi.fn(),
      stopGeneration: mocks.stopGeneration,
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
  ComposerPlusMenu: () => React.createElement("button", { "data-plus-menu": "true" }),
  ModelControlMenu: () => null,
  RenderStyleMenu: () => React.createElement("button", { "data-render-style": "true" }),
}));
vi.mock("@/features/chat/components/ChatInputBox", () => ({
  ChatInputBox: (props: CapturedInputBoxProps) => {
    capturedInputBox = props;
    return React.createElement("div", null, props.topContent, props.leadingControl);
  },
}));
vi.mock("@/features/chat/components/ChatHeader", () => ({
  default: (props: CapturedHeaderProps) => {
    capturedHeader = props;
    return React.createElement("header", null, props.title, props.renderStyleMenu);
  },
}));
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
  webSearch: false,
  outputModeId: "mode-initial",
  renderStyleId: "style-initial",
  reasoningByModelId: { "model-a": "off" },
};

function collectElements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(collectElements)];
}

function renderComposer(
  conversationId?: string,
  webSearchAvailable = false,
  renderStyles?: RenderStyleOption[],
): string {
  function CaptureComposer(props: React.ComponentProps<typeof ChatComposer>) {
    capturedComposerTree = ChatComposer(props);
    return capturedComposerTree;
  }
  return renderToStaticMarkup(
    <CaptureComposer
      models={models}
      conversationId={conversationId}
      webSearchAvailable={webSearchAvailable}
      renderStyles={renderStyles}
      createShareAction={async () => { throw new Error("unused"); }}
      listSharesAction={async () => []}
      revokeShareAction={async () => undefined}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.draft = null;
  mocks.queue = null;
  mocks.streaming = false;
  mocks.translate.mockImplementation((key) => ({
    browserOffline: "当前网络已断开，请联网后重试",
    composerSyncFailed: "输入区设置未同步",
    newConversation: "新对话",
    retry: "重试",
    welcomeTitle: "Nekusora",
  })[key] ?? key);
  capturedToolbar = null;
  capturedInputBox = null;
  capturedMessageList = null;
  capturedHeader = null;
  capturedRuntimeOptions = null;
  coordinatorState = {
    ...initialState,
    cardIds: [...initialState.cardIds],
    reasoningByModelId: { ...initialState.reasoningByModelId },
  };
  currentSnapshot = coordinatorState;
  syncStatus = "idle";
});

describe("ChatComposer coordinator integration", () => {
  it("queues text while generating without sending it immediately", () => {
    mocks.streaming = true;
    mocks.queue = ["先前问题"];
    mocks.draft = " 下一条问题 ";
    const html = renderComposer("conversation-a");

    capturedInputBox?.onSend();

    expect(mocks.queue).toEqual(["先前问题", "下一条问题"]);
    expect(mocks.draft).toBe("");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(html).toContain("queueSettings");
    expect(html).toContain("queueStopHint");
  });

  it("sends a waiting queue item with current settings and leaves draft attachments alone", () => {
    mocks.queue = ["第一条", "第二条"];
    mocks.draft = "正在编辑";
    const html = renderComposer("conversation-a");
    currentSnapshot = { ...currentSnapshot, modelId: "model-b", webSearch: true };
    const buttons = collectElements(capturedComposerTree).filter((node) => node.props["aria-label"] === "queueSendNow");
    expect(buttons).toHaveLength(2);
    (buttons[1].props.onClick as () => void)();

    expect(html).toContain("queueWaitingHint");
    expect(mocks.queue).toEqual(["第一条"]);
    expect(mocks.stopGeneration).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      "第二条", "provider/model-b", "model-b", ["card-initial"], true,
      expect.any(Object), expect.objectContaining({ includeAttachments: false, onRejected: expect.any(Function) }),
    );
    expect(mocks.draft).toBe("正在编辑");
    const onRejected = mocks.send.mock.calls[0][6].onRejected as () => void;
    onRejected();
    expect(mocks.draft).toBe("正在编辑\n第二条");
  });

  it("renders the style menu after the title and keeps the plus menu", () => {
    const html = renderComposer();

    expect(capturedHeader?.title).toBe("新对话");
    expect(capturedHeader?.conversationId).toBeUndefined();
    expect(html.indexOf("新对话")).toBeLessThan(html.indexOf("data-render-style"));
    expect(html).toContain("data-plus-menu");
  });

  it("forwards file selection and web search availability to the toolbar", () => {
    renderComposer(undefined, true);
    const files = [{ name: "notes.txt" } as File];

    capturedToolbar?.onUploadFiles(files);

    expect(mocks.handleUpload).toHaveBeenCalledWith(files);
    expect(capturedToolbar?.webSearchAvailable).toBe(true);
    expect(capturedMessageList?.onPreviewFile).toBe(capturedToolbar?.onPreviewFile);
  });

  it("passes one coherent render style snapshot to the message list", () => {
    renderComposer("conversation-a", false, [{
      id: "style-initial",
      name: "Paper",
      cssClass: "paper",
      renderer: "custom",
    }]);

    expect(capturedMessageList?.renderStyleClass).toBe("paper");
    expect(capturedMessageList?.renderStyleRenderer).toBe("custom");
    expect(capturedMessageList?.isPaper).toBe(true);
  });

  it("routes every selection control through domain transitions", () => {
    renderComposer("conversation-a");

    capturedToolbar?.onCardToggle("card-b");
    capturedToolbar?.onWebSearchToggle();
    capturedToolbar?.onOutputModeToggle("mode-b");
    capturedToolbar?.onRenderStyleToggle("style-b");
    capturedToolbar?.onModelChange("model-b");
    capturedToolbar?.onReasoningChange("high");

    expect(mocks.dispatch.mock.calls.map(([transition]) => transition)).toEqual([
      { type: "toggleCard", id: "card-b" },
      { type: "toggleWebSearch" },
      { type: "selectOutputMode", id: "mode-b" },
      { type: "selectRenderStyle", id: "style-b" },
      { type: "selectModel", modelId: "model-b" },
      { type: "setModelReasoning", modelId: "model-a", reasoning: "high" },
    ]);
  });

  it("send reads the latest synchronous snapshot", () => {
    renderComposer("conversation-a");
    currentSnapshot = {
      ...coordinatorState,
      cardIds: ["card-latest"],
      webSearch: true,
      outputModeId: null,
      renderStyleId: "style-latest",
      reasoningByModelId: { "model-a": "high", "model-b": "off" },
    };

    capturedInputBox?.onSend();

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
      expectedOptions,
      expect.objectContaining({ onAccepted: expect.any(Function), onRejected: expect.any(Function) }),
    );
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each(["", "已有问题"])("selection ask appends a multiline quote to draft %j without sending", (draft) => {
    mocks.draft = draft;
    renderComposer("conversation-a");

    capturedMessageList?.onAsk?.("第一行\r\n第二行\n\n第三行");

    expect(mocks.draft).toBe(`${draft ? `${draft}\n\n` : ""}> 第一行\n> 第二行\n> \n> 第三行\n\n`);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("adopts a new conversation with the exact snapshot used to create it", () => {
    renderComposer();
    const createSnapshot = currentSnapshot;

    capturedInputBox?.onSend();
    currentSnapshot = { ...currentSnapshot, cardIds: ["changed-during-create"] };
    capturedRuntimeOptions?.onConversationCreated?.("conversation-new");

    expect(mocks.adoptConversation).toHaveBeenCalledWith("conversation-new", createSnapshot);
  });

  it("maps the stable offline reason to localized copy", () => {
    renderComposer();

    capturedRuntimeOptions?.onRequestRejected?.("browser_offline");

    expect(mocks.translate).toHaveBeenCalledWith("browserOffline");
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
