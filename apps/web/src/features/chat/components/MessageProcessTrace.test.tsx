import type { ComponentProps, ReactElement, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let expanded = false;
let refs: { current: unknown }[] = [];
let refCursor = 0;
let effects: (() => void | (() => void))[] = [];

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [expanded, (next: SetStateAction<boolean>) => {
    expanded = typeof next === "function" ? next(expanded) : next;
  }],
  useRef: (initial: unknown) => {
    const index = refCursor++;
    return refs[index] ??= { current: initial };
  },
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useId: () => "process-panel",
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { MessageProcessTrace } from "./MessageProcessTrace";
import type { Popover } from "@/shared/ui/Popover";

type TraceProps = ComponentProps<typeof MessageProcessTrace>;
const runtime: NonNullable<TraceProps["processRuntime"]> = {
  runId: "run-1",
  lastSeq: 1,
  phase: "processing",
  steps: [{ id: "search", kind: "web_search", status: "completed" }],
  startedAt: "2026-09-16T00:00:00.000Z",
};
const props: TraceProps = {
  content: "",
  isStreaming: true,
  isLast: true,
  searchResults: [{ title: "Source", url: "https://example.com" }],
  processRuntime: runtime,
};

function render(input: TraceProps = props) {
  refCursor = 0;
  effects = [];
  const root = MessageProcessTrace(input) as ReactElement<{ children: ReactElement<ComponentProps<typeof Popover>> }>;
  effects.forEach((effect) => effect());
  return root.props.children.props;
}

function toggle() {
  const trigger = render().trigger as ReactElement<{ onClick: () => void }>;
  trigger.props.onClick();
}

beforeEach(() => {
  expanded = false;
  refs = [];
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("MessageProcessTrace disclosure", () => {
  it.each(["answering", "completed", "failed", "interrupted"] as const)("preserves user expansion on %s", (phase) => {
    expect(render().open).toBe(false);
    toggle();
    expect(render().open).toBe(true);

    const next = { ...props, processRuntime: { ...runtime, phase } };
    render(next);
    expect(render(next).open).toBe(true);
    render(next).onClose?.();
    expect(render(next).open).toBe(false);
  });

  it("resets expansion when a new run starts", () => {
    toggle();
    expect(render().open).toBe(true);
    const next = { ...props, processRuntime: { ...runtime, runId: "run-2" } };
    render(next);
    expect(render(next).open).toBe(false);
  });

  it("keeps legacy expansion while content and sources grow", () => {
    const legacy = { ...props, processRuntime: undefined };
    const trigger = render(legacy).trigger as ReactElement<{ onClick: () => void }>;
    trigger.props.onClick();
    const next = {
      ...legacy,
      content: "新增正文",
      isStreaming: false,
      searchResults: [...props.searchResults!, { title: "Another source", url: "https://example.org" }],
    };
    render(next);
    expect(render(next).open).toBe(true);
  });
});
