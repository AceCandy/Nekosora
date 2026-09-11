import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  branch: vi.fn(),
  state: vi.fn(),
  modes: vi.fn(),
  session: vi.fn(),
}));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/features/chat/actions/conversations", () => ({
  getVisibleModels: async () => [],
  getArtifactsByConversation: async () => ({}),
  getConversationComposerState: mocks.state,
}));
vi.mock("@/features/chat/actions/branch", () => ({ getVisibleBranch: mocks.branch }));
vi.mock("@/features/chat/actions/share", () => ({
  createShare: vi.fn(), listConversationShares: vi.fn(), revokeShare: vi.fn(),
}));
vi.mock("@/features/panel/cards/actions", () => ({ listMyCards: async () => [] }));
vi.mock("@/lib/output-modes/service", () => ({ listEnabledOutputModes: mocks.modes }));
vi.mock("@/lib/render-styles/service", () => ({ listEnabledRenderStyles: async () => [] }));
vi.mock("@nekusora/core/web-search/registry", () => ({ isWebSearchEnabled: async () => false }));
vi.mock("@/features/chat/components/ChatComposer", () => ({
  default: ({ initialTitle, initialMessages }: { initialTitle: string; initialMessages: { content: string }[] }) =>
    <section data-composer>{initialTitle}:{initialMessages.map((message) => message.content).join("|")}</section>,
}));
import Page from "./page";

describe("聊天页面加载边界", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ id: "user" });
    mocks.branch.mockResolvedValue({ messages: [], versionMap: {} });
    mocks.state.mockResolvedValue({ title: "真实会话" });
    mocks.modes.mockResolvedValue([]);
  });

  it.each(["branch", "state"] as const)("核心 %s 失败不渲染空会话，重试成功恢复数据", async (source) => {
    mocks[source].mockRejectedValueOnce(new Error("database unavailable"));
    await expect(Page({ params: Promise.resolve({ id: "conversation" }) })).rejects.toThrow();
    mocks.branch.mockResolvedValue({ messages: [{ id: "m", role: "user", content: "历史正文" }], versionMap: {} });
    expect(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "conversation" }) }))).toContain("历史正文");
  });

  it("真正空会话正常展示，模式失败不阻断", async () => {
    mocks.modes.mockRejectedValueOnce(new Error("optional unavailable"));
    expect(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "conversation" }) }))).toContain("真实会话");
  });

  it("登录跳转不变", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.session.mockRejectedValueOnce(redirect);
    await expect(Page({ params: Promise.resolve({ id: "conversation" }) })).rejects.toBe(redirect);
    expect(mocks.branch).not.toHaveBeenCalled();
  });
});
