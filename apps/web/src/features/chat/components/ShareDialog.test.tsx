import {
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

let stateValues: unknown[] = [];
let stateCursor = 0;
let refValues: { current: unknown }[] = [];
let refCursor = 0;
let transitionTasks: Promise<unknown>[] = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect: vi.fn(),
    useMemo: (factory: () => unknown) => factory(),
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
    useTransition: () => [false, (callback: () => unknown) => {
      transitionTasks.push(Promise.resolve(callback()));
    }],
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "existingTab") return `${key}:${values?.count ?? 0}`;
    if (key === "deadline") return `${key}:${values?.date ?? ""}`;
    return key;
  },
}));

vi.mock("@/shared/lib/clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

import ShareDialog from "./ShareDialog";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import Modal from "@/shared/ui/Modal";

interface TestElementProps {
  children?: ReactNode;
  onClick?: () => void;
  onClose?: () => void;
  onConfirm?: () => void;
  onChange?: (event: { target: { value: string; checked: boolean } }) => void;
  role?: string;
  type?: string;
  title?: string;
  ariaLabel?: string;
  open?: boolean;
  checked?: boolean;
  className?: string;
  disabled?: boolean;
  value?: string;
  min?: string;
  trigger?: ReactNode;
  ref?: { current: { showPicker?: () => void } | null };
  "aria-label"?: string;
}

function collectElements(node: ReactNode): ReactElement<TestElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (!isValidElement<TestElementProps>(node)) return [];
  return [
    node,
    ...collectElements(node.props.trigger),
    ...collectElements(node.props.children),
  ];
}

function elementText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!isValidElement<TestElementProps>(node)) return "";
  return elementText(node.props.children);
}

async function flushTransitions() {
  const tasks = transitionTasks;
  transitionTasks = [];
  await Promise.all(tasks);
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ShareDialog", () => {
  type ShareDialogProps = ComponentProps<typeof ShareDialog>;
  const createdShare = {
    shareId: "share-1",
    mode: "snapshot" as const,
    createdAt: new Date("2026-07-27T09:00:00Z"),
    expiresAt: new Date("2026-08-03T09:00:00Z"),
    status: "active" as const,
    hasPassword: false,
  };
  let createShareAction: ShareDialogProps["createShareAction"];
  let props: ShareDialogProps;

  const render = () => {
    stateCursor = 0;
    refCursor = 0;
    return ShareDialog(props);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { origin: "http://example.test" } });
    stateValues = [];
    stateCursor = 0;
    refValues = [];
    refCursor = 0;
    transitionTasks = [];
    mocks.copyToClipboard.mockReset().mockResolvedValue(true);
    createShareAction = vi.fn<ShareDialogProps["createShareAction"]>().mockResolvedValue(createdShare);
    props = {
      open: true,
      onClose: vi.fn(),
      conversationId: "conversation-1",
      canShare: true,
      createShareAction,
      listSharesAction: vi.fn().mockResolvedValue([]),
      revokeShareAction: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("creates without a render style and copies both share link buttons", async () => {
    let root = render();
    const createButton = collectElements(root).find((element) =>
      element.type === "button" && elementText(element) === "createLink");

    createButton?.props.onClick?.();
    await flushTransitions();

    expect(createShareAction).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      mode: "snapshot",
      expiration: { kind: "days", days: 7 },
      password: undefined,
    });
    expect(mocks.copyToClipboard).not.toHaveBeenCalled();

    root = render();
    const createdCopyButton = collectElements(root).find((element) =>
      element.type === "button" && element.props["aria-label"] === "copyLink");
    createdCopyButton?.props.onClick?.();
    await flushMicrotasks();
    expect(mocks.copyToClipboard).toHaveBeenLastCalledWith("http://example.test/share/share-1");

    root = render();
    expect(collectElements(root).some((element) => element.props["aria-label"] === "copied")).toBe(true);

    vi.advanceTimersByTime(2000);
    root = render();
    const existingTab = collectElements(root).find((element) =>
      element.type === "button" && element.props.role === "tab" && elementText(element) === "existingTab:1");
    existingTab?.props.onClick?.();

    root = render();
    const existingCopyButton = collectElements(root).find((element) =>
      element.type === "button" && element.props["aria-label"] === "copyLink");
    existingCopyButton?.props.onClick?.();
    await flushMicrotasks();
    expect(mocks.copyToClipboard).toHaveBeenLastCalledWith("http://example.test/share/share-1");
  });

  it("shows an accessible failure state when copying fails", async () => {
    let root = render();
    const createButton = collectElements(root).find((element) =>
      element.type === "button" && elementText(element) === "createLink");
    createButton?.props.onClick?.();
    await flushTransitions();

    vi.advanceTimersByTime(2000);
    mocks.copyToClipboard.mockResolvedValueOnce(false);
    root = render();
    const copyButton = collectElements(root).find((element) =>
      element.type === "button" && element.props["aria-label"] === "copyLink");
    copyButton?.props.onClick?.();
    await flushMicrotasks();

    root = render();
    const elements = collectElements(root);
    expect(elements.some((element) => element.props["aria-label"] === "copyFailed")).toBe(true);
    expect(elements.some((element) => element.props.role === "alert" && elementText(element) === "copyFailed")).toBe(true);
  });

  it("uses tabs as the first row and exposes quick expiration choices", () => {
    const root = render();
    const elements = collectElements(root);
    const modal = elements.find((element) => element.type === Modal);

    expect(modal?.props.title).toBeUndefined();
    expect(modal?.props.ariaLabel).toBe("configureTitle");
    expect(elements.filter((element) => element.props.role === "tab").map(elementText)).toEqual([
      "createTab",
      "existingTab:0",
    ]);
    const rowTexts = elements
      .filter((element) => element.type === "div" && element.props.className?.includes("items-center"))
      .map(elementText);
    expect(rowTexts).toContain("modesnapshotlive");
    expect(rowTexts.some((text) => text.startsWith("expiration"))).toBe(true);
    expect(rowTexts).toContain("passwordProtection");
    expect(["oneDay", "sevenDays", "thirtyDays", "forever", "custom"].every((label) =>
      elements.some((element) => element.type === "button" && elementText(element) === label))).toBe(true);
  });

  it("opens the custom picker, rejects expired time and submits a future deadline", async () => {
    vi.setSystemTime(new Date("2026-07-27T09:00:00Z"));
    let root = render();
    let elements = collectElements(root);
    const customInput = elements.find((element) => element.type === "input" && element.props.type === "datetime-local");
    const showPicker = vi.fn();
    expect(new Date(customInput?.props.min ?? "").getTime()).toBe(new Date().getTime());
    if (customInput?.props.ref) customInput.props.ref.current = { showPicker };
    elements.find((element) => element.type === "button" && elementText(element) === "custom")?.props.onClick?.();
    expect(showPicker).toHaveBeenCalledOnce();

    customInput?.props.onChange?.({ target: { value: "2020-01-01T00:00", checked: false } });
    root = render();
    elements = collectElements(root);
    expect(elements.some((element) => element.props.role === "alert" && elementText(element) === "expirationFuture")).toBe(true);

    const futureValue = "2030-01-01T12:00";
    elements.find((element) => element.type === "input" && element.props.type === "datetime-local")?.props.onChange?.({ target: { value: futureValue, checked: false } });
    root = render();
    elements = collectElements(root);
    expect(elements.some((element) => element.type === "button" && elementText(element).startsWith("deadline:"))).toBe(true);

    elements.find((element) => element.type === "button" && elementText(element) === "createLink")?.props.onClick?.();
    await flushTransitions();
    expect(createShareAction).toHaveBeenCalledWith(expect.objectContaining({
      expiration: { kind: "custom", value: new Date(futureValue).toISOString() },
    }));
  });

  it("keeps the password input on demand and confirms unsaved close requests", () => {
    let root = render();
    let elements = collectElements(root);
    const checkbox = elements.find((element) => element.type === "input" && element.props.type === "checkbox");
    checkbox?.props.onChange?.({ target: { value: "", checked: true } });

    root = render();
    elements = collectElements(root);
    const passwordInput = elements.find((element) => element.type === "input" && element.props.type === "password");
    expect(passwordInput).toBeDefined();
    expect(elements.find((element) => element.type === "button" && elementText(element) === "createLink")?.props.disabled).toBe(true);
    passwordInput?.props.onChange?.({ target: { value: "12345678", checked: false } });

    root = render();
    elements = collectElements(root);
    expect(elements.find((element) => element.type === "button" && elementText(element) === "createLink")?.props.disabled).toBe(false);
    elements.find((element) => element.type === Modal)?.props.onClose?.();

    root = render();
    const discardDialog = collectElements(root).find((element) =>
      element.type === ConfirmDialog && element.props.title === "discardTitle");
    expect(discardDialog?.props.open).toBe(true);
    expect(props.onClose).not.toHaveBeenCalled();
    discardDialog?.props.onConfirm?.();
    expect(props.onClose).toHaveBeenCalledOnce();

    root = render();
    elements = collectElements(root);
    expect(elements.some((element) => element.type === "input" && element.props.type === "password")).toBe(false);
    expect(elements.find((element) => element.type === "input" && element.props.type === "checkbox")?.props.checked).toBe(false);
  });

  it("closes an unchanged form without a discard confirmation", () => {
    const root = render();
    const elements = collectElements(root);

    elements.find((element) => element.type === Modal)?.props.onClose?.();

    expect(props.onClose).toHaveBeenCalledOnce();
    expect(elements.find((element) =>
      element.type === ConfirmDialog && element.props.title === "discardTitle")?.props.open).toBe(false);
  });

  it("closes without confirmation after the current form is saved", async () => {
    let root = render();
    collectElements(root).find((element) => element.type === "button" && elementText(element) === "live")?.props.onClick?.();
    root = render();
    collectElements(root).find((element) => element.type === "button" && elementText(element) === "createLink")?.props.onClick?.();
    await flushTransitions();

    root = render();
    collectElements(root).find((element) => element.type === Modal)?.props.onClose?.();
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
