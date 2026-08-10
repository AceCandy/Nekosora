import { readFileSync } from "node:fs";
import { createElement, forwardRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ProviderFormDialog from "./ProviderFormDialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/shared/ui/Modal", () => ({
  default: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

vi.mock("@/features/providers/KeyBundleEditor", () => ({
  default: forwardRef(function MockKeyBundleEditor() {
    return null;
  }),
}));

describe("ProviderFormDialog timeout fields", () => {
  it("提交 marker、原生范围并把毫秒值回显为秒", () => {
    const html = renderToStaticMarkup(
      <ProviderFormDialog
        open
        onClose={() => undefined}
        mode="edit"
        action={async () => undefined}
        protocols={[{ value: "openai", label: "OpenAI" }]}
        initial={{
          protocol: "openai",
          connectTimeoutMs: 1_250,
          readTimeoutMs: null,
          streamIdleTimeoutMs: 900_000,
        }}
      />,
    );

    expect(html).toContain('name="providerTimeoutsPresent" value="1"');
    const connect = html.match(/<input type="number"[^>]*name="connectTimeoutSeconds"[^>]*>/)?.[0];
    const read = html.match(/<input type="number"[^>]*name="readTimeoutSeconds"[^>]*>/)?.[0];
    const idle = html.match(/<input type="number"[^>]*name="streamIdleTimeoutSeconds"[^>]*>/)?.[0];
    expect(connect).toContain('min="1"');
    expect(connect).toContain('max="300"');
    expect(connect).toContain('step="0.001"');
    expect(connect).toContain('value="1.25"');
    expect(read).toContain('min="10"');
    expect(read).toContain('max="3600"');
    expect(read).toContain('value=""');
    expect(idle).toContain('min="5"');
    expect(idle).toContain('max="900"');
    expect(idle).toContain('value="900"');
  });

  it("中英文包含相同的 timeout 文案键", () => {
    const en = JSON.parse(readFileSync("apps/web/messages/en.json", "utf8")) as Record<string, Record<string, unknown>>;
    const zh = JSON.parse(readFileSync("apps/web/messages/zh-CN.json", "utf8")) as Record<string, Record<string, unknown>>;
    const keys = [
      "timeoutTitle",
      "timeoutHint",
      "connectTimeoutLabel",
      "readTimeoutLabel",
      "streamIdleTimeoutLabel",
      "timeoutRangeHint",
    ];

    for (const key of keys) {
      expect(en.providers?.[key]).toEqual(expect.any(String));
      expect(zh.providers?.[key]).toEqual(expect.any(String));
    }
  });
});
