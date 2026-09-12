import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let states: unknown[] = [];
let cursor = 0;
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (next: unknown) => { states[index] = next; }];
  },
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/shared/ui/UnsavedChangesDialog", () => ({
  default: () => null,
  useUnsavedChanges: (onClose: () => void) => ({ contentRef: () => {}, requestClose: onClose, dialogProps: {} }),
}));

import MemoryAddDialog from "./MemoryAddDialog";
import Modal from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

describe("MemoryAddDialog", () => {
  beforeEach(() => { states = []; cursor = 0; });
  afterEach(() => vi.restoreAllMocks());

  it("opens from a primary button, keeps the dialog on failure and closes after retry succeeds", async () => {
    const action = vi.fn<(data: FormData) => Promise<void>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(undefined);
    const render = () => { cursor = 0; return elements(MemoryAddDialog({ action })); };
    const modal = () => render().find((node) => node.type === Modal)!;
    const trigger = render().find((node) => node.type === Button)!;
    expect(trigger.props).toMatchObject({ variant: "primary", size: "sm" });
    expect(modal().props.open).toBe(false);
    (trigger.props.onClick as () => void)();
    expect(modal().props.open).toBe(true);

    const data = new FormData();
    data.set("scope", "profile");
    data.set("content", "测试记忆");
    vi.spyOn(globalThis, "FormData").mockImplementation(function () { return data; });
    const form = render().find((node) => node.type === "form")!;
    const submit = form.props.onSubmit as (event: { preventDefault: () => void; currentTarget: HTMLFormElement }) => Promise<void>;
    const event = { preventDefault: vi.fn(), currentTarget: {} as HTMLFormElement };

    await submit(event);
    expect(action).toHaveBeenCalledWith(data);
    expect(modal().props.open).toBe(true);
    expect(render().find((node) => node.props.role === "alert")?.props.children).toBe("saveFailed");

    await submit(event);
    expect(modal().props.open).toBe(false);
  });
});
