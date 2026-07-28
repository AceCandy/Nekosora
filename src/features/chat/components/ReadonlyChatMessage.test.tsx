import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadonlyChatMessage } from "./ReadonlyChatMessage";

describe("ReadonlyChatMessage", () => {
  it("keeps a short user message bubble content-sized", () => {
    const html = renderToStaticMarkup(
      <ReadonlyChatMessage role="user" content="Short question" />,
    );

    expect(html).toContain(
      '<div class="flex justify-end"><div class="flex w-full max-w-[82%] flex-col items-end"><div class="relative',
    );
    expect(html).toContain(">Short question</div></div></div>");
    expect(html).not.toContain('items-end"><div class="w-full');
  });

  it("keeps long unbroken user content within the wrapping constraint", () => {
    const content = "x".repeat(500);
    const html = renderToStaticMarkup(
      <ReadonlyChatMessage role="user" content={content} />,
    );

    expect(html).toContain("max-w-[82%]");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain(content);
  });
});
