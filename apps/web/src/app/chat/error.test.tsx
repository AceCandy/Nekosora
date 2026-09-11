import { isValidElement, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh-CN.json";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), pending: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: keyof typeof zh.chat) => zh.chat[key] }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useTransition: () => [mocks.pending, (fn: () => void) => fn()],
}));
import ChatError from "./error";
import { Button } from "@/shared/ui/Button";

function elements(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void; loading?: boolean }>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...elements(node.props.children)];
}

describe("聊天加载错误页", () => {
  it("只显示安全文案，点击重试刷新服务端数据并重置错误边界", () => {
    const reset = vi.fn();
    const tree = ChatError({ error: new Error("private database failure"), reset });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(zh.chat.loadFailed);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("private");
    elements(tree).find((element) => element.type === Button)?.props.onClick?.();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
    expect(en.chat.loadFailed).toBeTruthy();
    expect(en.chat.loadFailedHint).toBeTruthy();
  });
  it("刷新期间按钮进入 loading 状态", () => {
    mocks.pending = true;
    const tree = ChatError({ error: new Error(), reset: vi.fn() });
    expect(elements(tree).find((element) => element.type === Button)?.props.loading).toBe(true);
    mocks.pending = false;
  });
});
