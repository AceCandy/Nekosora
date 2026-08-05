import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FilePreviewModal from "./FilePreviewModal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("FilePreviewModal", () => {
  it("renders images without a file header or bordered container", () => {
    const html = renderToStaticMarkup(
      <FilePreviewModal
        file={{ fileId: "image-1", filename: "photo.png", mime: "image/png" }}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('aria-label="photo.png"');
    expect(html).toContain("border-0 bg-transparent");
    expect(html).toContain('aria-label="关闭"');
    expect(html).not.toContain("<header");
    const imageClass = html.match(/<img[^>]+class="([^"]+)"/)?.[1] ?? "";
    expect(imageClass).not.toContain("rounded");
  });

  it("keeps the existing header and container for non-image previews", () => {
    const html = renderToStaticMarkup(
      <FilePreviewModal
        file={{ fileId: "audio-1", filename: "recording.mp3", mime: "audio/mpeg" }}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("<header");
    expect(html).toContain("recording.mp3");
    expect(html).toContain("border-morning-mist");
  });
});
