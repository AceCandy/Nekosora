import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/chat/store/chatStreamStore", () => ({
  NEW_CONVERSATION_KEY: "__new__",
  useChatStreamStore: (selector: (state: { runtimes: Record<string, never>; send: typeof mocks.send }) => unknown) =>
    selector({ runtimes: {}, send: mocks.send }),
}));

import { useChatRuntime } from "./useChatRuntime";

describe("useChatRuntime attachment boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([true, false])("includeAttachments=%s controls all attachment hooks", (includeAttachments) => {
    const uploadAttachments = vi.fn().mockResolvedValue([]);
    const onAttachmentsConsumed = vi.fn();
    let send: ReturnType<typeof useChatRuntime>["send"] | undefined;
    function Probe() {
      send = useChatRuntime({
        conversationId: "conversation-1",
        hasAttachments: true,
        uploadAttachments,
        onAttachmentsConsumed,
      }).send;
      return null;
    }
    renderToStaticMarkup(<Probe />);

    send?.("message", "model-name", "model-id", [], false, undefined,
      includeAttachments ? undefined : { includeAttachments: false });

    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      "conversation-1", "message",
      expect.objectContaining({ model: "model-name", modelId: "model-id" }),
      expect.objectContaining({
        hasAttachments: includeAttachments,
        uploadAttachments: includeAttachments ? uploadAttachments : undefined,
        onAttachmentsConsumed: includeAttachments ? onAttachmentsConsumed : undefined,
      }),
    );
  });
});
