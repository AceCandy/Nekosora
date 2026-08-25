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
import { resolveSettingsSelection } from "./settings-selection";

describe("SettingsTabs", () => {
  it("只提供系统设置分类和当前复合领域的子视图", () => {
    const html = renderToStaticMarkup(<SettingsTabs tab="output" view="styles" />);

    expect(html).not.toContain('type="search"');
    expect(html).toContain("<select");
    expect(html).toContain('aria-label="tabs.ariaLabel"');
    expect(html).toContain('aria-label="tabs.outputAriaLabel"');
    expect(html).toContain('href="/admin/settings?tab=output&amp;view=modes"');
    expect(html).toContain('href="/admin/settings?tab=output&amp;view=styles"');
    expect(html).toContain('aria-current="page"');
  });

  it("兼容旧 tab 并为复合领域选择稳定默认视图", () => {
    expect(resolveSettingsSelection("basic", "")).toEqual({ tab: "protocol" });
    expect(resolveSettingsSelection("model", "")).toEqual({ tab: "models" });
    expect(resolveSettingsSelection("output-modes", "")).toEqual({ tab: "output", view: "modes" });
    expect(resolveSettingsSelection("render-styles", "")).toEqual({ tab: "output", view: "styles" });
    expect(resolveSettingsSelection("output", "unknown")).toEqual({ tab: "output", view: "modes" });
    expect(resolveSettingsSelection("governance", "history")).toEqual({ tab: "governance", view: "history" });
    expect(resolveSettingsSelection("unknown", "")).toEqual({ tab: "models" });
  });

  it("中英文目录同步提供子视图名称", () => {
    expect(zhMessages.admin.settings.tabs.governancePolicy).toBe("策略配置");
    expect(enMessages.admin.settings.tabs.governanceHistory).toBe("Runtime history");
    expect(zhMessages.admin.settings.tabs.outputAriaLabel).toEqual(expect.any(String));
    expect(enMessages.admin.settings.tabs.governanceAriaLabel).toEqual(expect.any(String));
  });
});
