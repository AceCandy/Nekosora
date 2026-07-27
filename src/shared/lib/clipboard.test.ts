import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back when the Clipboard API is unavailable", async () => {
    const textarea = { value: "", style: {}, select: vi.fn() };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: vi.fn(() => textarea),
      body: { appendChild, removeChild },
      execCommand,
    });

    await expect(copyToClipboard("http://example.test/share/1")).resolves.toBe(true);
    expect(textarea.value).toBe("http://example.test/share/1");
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });

  it("removes the temporary textarea when the fallback throws", async () => {
    const textarea = { value: "", style: {}, select: vi.fn() };
    const removeChild = vi.fn();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn(), removeChild },
      execCommand: vi.fn(() => { throw new Error("copy failed"); }),
    });

    await expect(copyToClipboard("text")).resolves.toBe(false);
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });
});
