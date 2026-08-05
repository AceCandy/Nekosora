import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKDOWN_CONTROLS, shouldCollapseCodeBlock } from "./markdownControls";

const mocks = vi.hoisted(() => ({
  createPortal: vi.fn((node: unknown) => node),
}));

vi.mock("react-dom", () => ({ createPortal: mocks.createPortal }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { MarkdownLinkSafetyModal } from "./Markdown";

const originalDocument = globalThis.document;

afterEach(() => {
  mocks.createPortal.mockClear();
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("Markdown", () => {
  it("禁用 Streamdown 原生代码块 actions,由 Nekosora 自定义紧凑按钮接管", () => {
    expect(MARKDOWN_CONTROLS).toMatchObject({
      table: false,
      code: false,
    });
  });

  it("把链接安全确认层 Portal 到 body，避免块元素进入 Markdown 段落", () => {
    const body = {};
    Object.defineProperty(globalThis, "document", { configurable: true, value: { body } });

    const html = renderToStaticMarkup(createElement(MarkdownLinkSafetyModal, {
      isOpen: true,
      onClose: () => {},
      onConfirm: () => {},
      url: "https://example.com",
    }));

    expect(mocks.createPortal).toHaveBeenCalledWith(expect.anything(), body);
    expect(html).toContain("<dialog");
    expect(html).toContain("https://example.com");
  });

  it("流式期间保持长代码展开,结束后才允许折叠", () => {
    expect(shouldCollapseCodeBlock(17, true)).toBe(false);
    expect(shouldCollapseCodeBlock(17, false)).toBe(true);
    expect(shouldCollapseCodeBlock(16, false)).toBe(false);
  });
});
