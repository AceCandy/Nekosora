import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back when the Clipboard API is unavailable", async () => {
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
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
    expect(textarea.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(0, textarea.value.length);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(removeChild).toHaveBeenCalledWith(textarea);
  });

  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyToClipboard("http://example.test/share/1")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("http://example.test/share/1");
  });

  it("falls back when the Clipboard API rejects the request", async () => {
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    });

    await expect(copyToClipboard("http://example.test/share/2")).resolves.toBe(true);
    expect(textarea.value).toBe("http://example.test/share/2");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back when accessing the Clipboard API throws", async () => {
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    const execCommand = vi.fn(() => true);
    const navigatorMock = {};
    Object.defineProperty(navigatorMock, "clipboard", {
      get: () => { throw new Error("blocked"); },
    });
    vi.stubGlobal("navigator", navigatorMock);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    });

    await expect(copyToClipboard("text")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("appends the fallback textarea inside an open dialog", async () => {
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    const dialog = { appendChild: vi.fn(), removeChild: vi.fn() };
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      activeElement: { closest: vi.fn(() => dialog) },
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: vi.fn(() => true),
    });

    await expect(copyToClipboard("http://example.test/share/3")).resolves.toBe(true);
    expect(document.activeElement?.closest).toHaveBeenCalledWith("dialog[open]");
    expect(dialog.appendChild).toHaveBeenCalledWith(textarea);
    expect(dialog.removeChild).toHaveBeenCalledWith(textarea);
  });

  it("removes the temporary textarea when the fallback throws", async () => {
    const textarea = {
      value: "",
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
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
