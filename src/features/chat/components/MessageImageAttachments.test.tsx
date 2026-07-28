import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { MessageImageAttachments } from "./MessageImageAttachments";

describe("MessageImageAttachments", () => {
  it("在消息内渲染图片且不增加文件表头", () => {
    const html = renderToStaticMarkup(
      <MessageImageAttachments
        attachments={[
          { fileId: "image-1", filename: "photo.png", mime: "image/png" },
        ]}
      />,
    );

    expect(html).toContain('src="/api/files/image-1"');
    expect(html).toContain('alt="photo.png"');
    expect(html).toContain("aspect-[4/3]");
    expect(html).not.toContain("<header");
    expect(html).not.toContain("border-morning-mist");
  });

  it("编辑态提供稳定尺寸的移除按钮", () => {
    const html = renderToStaticMarkup(
      <MessageImageAttachments
        attachments={[
          { fileId: "image-1", filename: "one.png", mime: "image/png" },
          { fileId: "image-2", filename: "two.png", mime: "image/png" },
        ]}
        onRemove={() => undefined}
      />,
    );

    expect(html).toContain("grid-cols-2");
    expect(html.match(/aria-label="attachRemove:/g)).toHaveLength(2);
    expect(html).toContain("h-8 w-8");
  });
});
