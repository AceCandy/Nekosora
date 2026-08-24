import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../../../messages/en.json";
import zhMessages from "../../../../../messages/zh-CN.json";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
  it("提供四分类导航、搜索与移动端原生选择器", () => {
    const html = renderToStaticMarkup(<SettingsTabs current="governance" />);

    expect(html).toContain('type="search"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("<select");
    expect(html).toContain("touch-target");
    expect(html).toContain('aria-label="tabs.ariaLabel"');
    expect(html).toContain('href="/admin/settings?tab=governance"');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/href="\/admin\/settings\?tab=/g)).toHaveLength(4);
  });

  it("中英文目录同步提供治理标签和导航名称", () => {
    expect(zhMessages.admin.settings.tabs.governance).toBe("流量治理");
    expect(enMessages.admin.settings.tabs.governance).toBe("Request governance");
    expect(zhMessages.admin.settings.tabs.ariaLabel).toEqual(expect.any(String));
    expect(enMessages.admin.settings.tabs.ariaLabel).toEqual(expect.any(String));
  });
});
