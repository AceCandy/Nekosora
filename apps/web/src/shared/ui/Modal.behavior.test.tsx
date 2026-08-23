import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dialogRef: { current: null as HTMLDialogElement | null },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: vi.fn(),
    useId: () => "modal-title",
    useRef: () => mocks.dialogRef,
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import Modal from "@/shared/ui/Modal";

interface TestElementProps {
  children?: ReactNode;
  onClick?: (event: { target: unknown }) => void;
  onCancel?: (event: { preventDefault: () => void }) => void;
  onClose?: () => void;
  "aria-label"?: string;
}

function collectElements(node: ReactNode): ReactElement<TestElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (!isValidElement<TestElementProps>(node)) return [];
  return [node, ...collectElements(node.props.children)];
}

describe("Modal close behavior", () => {
  it("routes backdrop, Escape and the close button through onClose", () => {
    const onClose = vi.fn();
    const dialogNode = {} as HTMLDialogElement;
    mocks.dialogRef.current = dialogNode;
    const modal = Modal({ open: true, onClose, title: "Settings", children: "content" }) as ReactElement<TestElementProps>;
    const preventDefault = vi.fn();

    modal.props.onClick?.({ target: dialogNode });
    modal.props.onCancel?.({ preventDefault });
    collectElements(modal).find((element) => element.props["aria-label"] === "close")?.props.onClick?.({ target: null });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
