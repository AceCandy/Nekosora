import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImagePreviewModal from "./ImagePreviewModal";

const mocks = vi.hoisted(() => ({
  createPortal: vi.fn((node: unknown) => node),
}));

vi.mock("react-dom", () => ({ createPortal: mocks.createPortal }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const originalDocument = globalThis.document;

afterEach(() => {
  mocks.createPortal.mockClear();
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("ImagePreviewModal", () => {
  it("使用透明 lightbox 展示大图和可选操作条", () => {
    const body = {};
    Object.defineProperty(globalThis, "document", { configurable: true, value: { body } });

    const html = renderToStaticMarkup(
      <ImagePreviewModal
        open
        onClose={() => {}}
        src="/api/files/image-1"
        alt="photo.png"
        toolbar={<button type="button">action</button>}
      />,
    );

    expect(mocks.createPortal).toHaveBeenCalledWith(expect.anything(), body);
    expect(html).toContain('aria-label="photo.png"');
    expect(html).toContain("border-0 bg-transparent");
    expect(html).toContain("backdrop:bg-black/75");
    expect(html).toContain("max-h-[92dvh]");
    expect(html).toContain("max-w-[96vw]");
    expect(html).toContain('aria-label="close"');
    expect(html).toContain('role="toolbar"');
    expect(html).not.toContain("<header");
  });
});
