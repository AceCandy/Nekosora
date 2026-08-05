import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ReadonlyChatMessage } from "./ReadonlyChatMessage";

const messages = {
  chat: {
    inputTokens: "Input",
    cacheReadTokens: "Cache",
    outputTokens: "Output",
    responseModel: "Model",
    responseDuration: "Duration",
  },
};

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

  it("shows the assistant run metadata below the shared reply", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ReadonlyChatMessage
          role="assistant"
          content="Answer"
          runMetadata={{
            model: "actual-model",
            tokenUsage: { promptTokens: 1200, completionTokens: 80 },
            durationMs: 1500,
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(html).toContain("actual-model");
    expect(html).toContain("1,200");
    expect(html).toContain("80");
    expect(html).toContain("1.5s");
    expect(html.indexOf("Answer")).toBeLessThan(html.indexOf("actual-model"));
    expect(html).toContain("group/shared-message");
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover/shared-message:opacity-100");
    expect(html).toContain("group-focus-within/shared-message:opacity-100");
    expect(html).toContain("[@media(pointer:coarse)]:opacity-100");
  });
});
