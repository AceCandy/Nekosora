import {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stateValues: unknown[] = [];
let stateCursor = 0;
let refValues: { current: unknown }[] = [];
let refCursor = 0;
let effects: Array<() => void | (() => void)> = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    useRef: (initial: unknown) => {
      const index = refCursor++;
      if (!(index in refValues)) refValues[index] = { current: initial };
      return refValues[index];
    },
    useState: (initial: unknown) => {
      const index = stateCursor++;
      if (!(index in stateValues)) {
        stateValues[index] = typeof initial === "function"
          ? (initial as () => unknown)()
          : initial;
      }
      const setValue = (next: unknown) => {
        stateValues[index] = typeof next === "function"
          ? (next as (current: unknown) => unknown)(stateValues[index])
          : next;
      };
      return [stateValues[index], setValue];
    },
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import ImageStudio from "./ImageStudio";
import { Button } from "@/shared/ui/Button";

interface TestElementProps {
  children?: ReactNode;
  onClick?: () => Promise<void>;
  value?: string | number;
}

function collectElements(node: ReactNode): ReactElement<TestElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (!isValidElement<TestElementProps>(node)) return [];
  return [node, ...collectElements(node.props.children)];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function render() {
  stateCursor = 0;
  refCursor = 0;
  effects = [];
  return ImageStudio({
    models: [{ modelId: "model-1", name: "upstream-model", displayName: "Model 1" }],
  });
}

describe("ImageStudio", () => {
  beforeEach(() => {
    stateValues = ["removed-model", "draw a cat", 1, "1024x1024", false, null, [], []];
    stateCursor = 0;
    refValues = [];
    refCursor = 0;
    effects = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a valid model after the models prop changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ urls: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const elements = collectElements(render());

    expect(elements.find((element) => element.type === "select")?.props.value).toBe("model-1");
    await elements.find((element) => element.type === Button)?.props.onClick?.();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "upstream-model",
      modelId: "model-1",
    });
  });

  it("aborts the initial history request on cleanup", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render();

    const cleanup = effects[0]?.();
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal | undefined;
    cleanup?.();

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });

  it("keeps a stale history response from overwriting a refresh", async () => {
    const initial = deferred<{ ok: boolean; json: () => Promise<{ jobs: unknown[] }> }>();
    const freshJobs = [{ id: "fresh" }];
    let historyRequests = 0;
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url === "/api/images/generate") {
        return Promise.resolve({ ok: true, json: async () => ({ urls: [] }) });
      }
      historyRequests += 1;
      return historyRequests === 1
        ? initial.promise
        : Promise.resolve({ ok: true, json: async () => ({ jobs: freshJobs }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    stateValues[0] = "model-1";
    const elements = collectElements(render());
    effects[0]?.();

    await elements.find((element) => element.type === Button)?.props.onClick?.();
    await vi.waitFor(() => expect(stateValues[7]).toEqual(freshJobs));

    initial.resolve({ ok: true, json: async () => ({ jobs: [{ id: "stale" }] }) });
    await Promise.resolve();
    await Promise.resolve();

    expect(stateValues[7]).toEqual(freshJobs);
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });
});
