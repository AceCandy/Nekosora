import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/settings-control/runtime", () => ({ invalidateSettingsRuntime: mocks.invalidate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { refreshSettings } from "./refresh-settings";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue(false);
});

describe("refreshSettings", () => {
  it("invalidates the previous generation only after a real save", async () => {
    expect(await refreshSettings({ revision: 4, changeSetId: "save-4" })).toBe(false);
    expect(mocks.invalidate).toHaveBeenCalledWith(3);
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/settings");
  });

  it("does not invalidate caches for an unchanged save", async () => {
    expect(await refreshSettings({ revision: 4, changeSetId: null })).toBe(false);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("reports a warning, not a failed save, if post-commit work fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.invalidate.mockRejectedValueOnce(new Error("cache unavailable"));
      expect(await refreshSettings({ revision: 4, changeSetId: "save-4" })).toBe(true);
      expect(mocks.revalidate).toHaveBeenCalled();
      mocks.revalidate.mockImplementationOnce(() => { throw new Error("refresh unavailable"); });
      expect(await refreshSettings({ revision: 5, changeSetId: "save-5" })).toBe(true);
    } finally {
      warning.mockRestore();
    }
  });
});
