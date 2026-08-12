import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../../../messages/en.json";
import zhMessages from "../../../../../messages/zh-CN.json";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => createElement("a", { ...props, href }, children),
}));

import { SettingsTabs } from "./SettingsTabs";

describe("SettingsTabs", () => {
  it("提供第五个治理入口并在窄屏允许换行", () => {
    const html = renderToStaticMarkup(<SettingsTabs current="governance" />);

    expect(html).toContain("flex-wrap");
    expect(html).toContain("touch-target");
    expect(html).toContain('aria-label="ariaLabel"');
    expect(html).toContain('href="/admin/settings?tab=governance"');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/href="\/admin\/settings\?tab=/g)).toHaveLength(5);
  });

  it("中英文目录同步提供治理标签和导航名称", () => {
    expect(zhMessages.admin.settings.tabs.governance).toBe("流量治理");
    expect(enMessages.admin.settings.tabs.governance).toBe("Request governance");
    expect(zhMessages.admin.settings.tabs.ariaLabel).toEqual(expect.any(String));
    expect(enMessages.admin.settings.tabs.ariaLabel).toEqual(expect.any(String));
  });
});
