import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import Popover from "./Popover";

const captured = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  layout: [] as (() => (() => void) | undefined)[],
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof React>(),
  useRef: (initial: unknown) => {
    const ref = { current: initial };
    captured.refs.push(ref);
    return ref;
  },
  useLayoutEffect: (effect: () => (() => void) | undefined) => captured.layout.push(effect),
}));
vi.mock("@/shared/lib/useClickOutside", () => ({ useClickOutside: () => {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  captured.refs.length = 0;
  captured.layout.length = 0;
});

it("dialog 内浮层进入原生顶层，定位可见后才把焦点交给搜索框", () => {
  vi.stubGlobal("document", {});
  vi.stubGlobal("window", { innerWidth: 390, innerHeight: 844, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const html = renderToStaticMarkup(<Popover open portal={false} trigger={<button>Preview</button>}><input data-autofocus /></Popover>);
  expect(html).toContain('popover="manual"');
  const style = { visibility: "hidden", left: "", top: "" };
  const showPopover = vi.fn();
  const focus = vi.fn(() => expect(style.visibility).toBe("visible"));
  captured.refs.at(-2)!.current = {
    getBoundingClientRect: () => ({ left: 100, right: 140, top: 100, bottom: 134 }),
  };
  captured.refs.at(-1)!.current = {
    style, offsetWidth: 300, offsetHeight: 146, showPopover,
    querySelector: () => ({ focus }),
  };
  const cleanup = captured.layout[0]();
  expect(showPopover).toHaveBeenCalledOnce();
  expect(style).toMatchObject({ left: "82px", top: "138px" });
  expect(focus).toHaveBeenCalledOnce();
  cleanup?.();
});
