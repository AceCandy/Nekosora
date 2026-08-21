import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stateSetters: ReturnType<typeof vi.fn>[] = [];
let stateCursor = 0;
let effect: (() => void | (() => void)) | undefined;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (callback: () => void | (() => void)) => {
      effect = callback;
    },
    useState: (initial: unknown) => {
      const index = stateCursor++;
      stateSetters[index] ??= vi.fn();
      return [initial, stateSetters[index]];
    },
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import PreviewText from "./PreviewText";

function render() {
  stateCursor = 0;
  effect = undefined;
  PreviewText({ url: "/api/files/text-1", filename: "notes.txt", mime: "text/plain" });
}

describe("PreviewText", () => {
  beforeEach(() => {
    stateSetters = [];
    stateCursor = 0;
    effect = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts the current fetch on cleanup", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render();

    const cleanup = effect?.();
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal | undefined;
    cleanup?.();

    expect(fetchMock).toHaveBeenCalledWith("/api/files/text-1", {
      headers: { Range: "bytes=0-524288" },
      signal: expect.any(AbortSignal),
    });
    expect(signal?.aborted).toBe(true);
  });

  it("does not surface AbortError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    render();
    effect?.();
    stateSetters[1].mockClear();

    await Promise.resolve();
    await Promise.resolve();

    expect(stateSetters[1]).not.toHaveBeenCalled();
  });

  it("keeps the preview bounded to 512 KiB", async () => {
    const bytes = new Uint8Array(512 * 1024 + 1).fill(97);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer,
    }));
    render();
    effect?.();
    stateSetters[0].mockClear();
    stateSetters[2].mockClear();

    await vi.waitFor(() => expect(stateSetters[0]).toHaveBeenCalled());

    expect(stateSetters[0].mock.calls.at(-1)?.[0]).toHaveLength(512 * 1024);
    expect(stateSetters[2]).toHaveBeenLastCalledWith(true);
  });
});
