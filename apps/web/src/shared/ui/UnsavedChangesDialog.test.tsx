import type { ComponentProps, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let stateValues: unknown[] = [];
let stateCursor = 0;
let refValues: { current: unknown }[] = [];
let refCursor = 0;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useRef: (initial: unknown) => {
      const index = refCursor++;
      if (!(index in refValues)) refValues[index] = { current: initial };
      return refValues[index];
    },
    useState: (initial: unknown) => {
      const index = stateCursor++;
      if (!(index in stateValues)) stateValues[index] = initial;
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

import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import UnsavedChangesDialog, { useUnsavedChanges } from "@/shared/ui/UnsavedChangesDialog";

interface TestControl {
  tagName: "INPUT" | "SELECT" | "TEXTAREA";
  type?: string;
  value: string;
  checked?: boolean;
  multiple?: boolean;
  selectedOptions?: { value: string }[];
}

function rootWith(...controls: TestControl[]): HTMLFormElement {
  return { querySelectorAll: () => controls } as unknown as HTMLFormElement;
}

describe("useUnsavedChanges", () => {
  let onClose = vi.fn<() => void>();

  const render = () => {
    stateCursor = 0;
    refCursor = 0;
    // Hooks are invoked directly because React is replaced with the deterministic test harness above.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useUnsavedChanges<HTMLFormElement>(onClose);
  };

  beforeEach(() => {
    stateValues = [];
    stateCursor = 0;
    refValues = [];
    refCursor = 0;
    onClose = vi.fn<() => void>();
  });

  it("closes an unchanged form directly", () => {
    const guard = render();
    guard.contentRef(rootWith({ tagName: "INPUT", type: "text", value: "initial" }));

    guard.requestClose();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps dirty input while continuing to edit", () => {
    const input: TestControl = { tagName: "INPUT", type: "text", value: "initial" };
    let guard = render();
    guard.contentRef(rootWith(input));
    input.value = "changed";

    guard.requestClose();
    guard = render();
    expect(guard.dialogProps.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    guard.dialogProps.onClose();
    guard = render();
    expect(guard.dialogProps.open).toBe(false);
    expect(input.value).toBe("changed");
  });

  it("closes without confirmation after restoring the baseline", () => {
    const input: TestControl = { tagName: "TEXTAREA", value: "initial" };
    const guard = render();
    guard.contentRef(rootWith(input));
    input.value = "changed";
    input.value = "initial";

    guard.requestClose();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes after discarding dirty changes", () => {
    const checkbox: TestControl = { tagName: "INPUT", type: "checkbox", value: "on", checked: false };
    let guard = render();
    guard.contentRef(rootWith(checkbox));
    checkbox.checked = true;
    guard.requestClose();

    guard = render();
    guard.dialogProps.onConfirm();

    expect(onClose).toHaveBeenCalledOnce();
    expect(render().dialogProps.open).toBe(false);
  });

  it("tracks multiple selections and ignores submit inputs", () => {
    const submit: TestControl = { tagName: "INPUT", type: "submit", value: "Save" };
    const select: TestControl = {
      tagName: "SELECT",
      value: "a",
      multiple: true,
      selectedOptions: [{ value: "a" }],
    };
    let guard = render();
    guard.contentRef(rootWith(submit, select));
    submit.value = "Changed label";
    guard.requestClose();
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    select.selectedOptions = [{ value: "a" }, { value: "b" }];
    guard.requestClose();
    guard = render();
    expect(guard.dialogProps.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("UnsavedChangesDialog", () => {
  it("uses the shared localized copy", () => {
    const props: ComponentProps<typeof UnsavedChangesDialog> = {
      open: true,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    };
    const dialog = UnsavedChangesDialog(props) as ReactElement<ComponentProps<typeof ConfirmDialog>>;

    expect(dialog.type).toBe(ConfirmDialog);
    expect(dialog.props).toMatchObject({
      title: "unsavedChangesTitle",
      message: "unsavedChangesMessage",
      confirmLabel: "discardChanges",
      cancelLabel: "continueEditing",
    });
  });
});
