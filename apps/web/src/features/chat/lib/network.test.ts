import { afterEach, describe, expect, it, vi } from "vitest";
import { isBrowserOffline } from "@/features/chat/lib/network";

describe("isBrowserOffline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("仅在浏览器明确报告离线时返回 true", () => {
    vi.stubGlobal("navigator", { onLine: false });

    expect(isBrowserOffline()).toBe(true);
  });

  it.each([undefined, {}, { onLine: true }])("对 SSR 或未知状态继续放行", (navigatorValue) => {
    vi.stubGlobal("navigator", navigatorValue);

    expect(isBrowserOffline()).toBe(false);
  });
});
