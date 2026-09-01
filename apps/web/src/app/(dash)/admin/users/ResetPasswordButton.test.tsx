import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../../../messages/en.json";
import zhMessages from "../../../../../messages/zh-CN.json";
import { ResetPasswordDialog } from "./ResetPasswordButton";

const { useUnsavedChangesMock } = vi.hoisted(() => ({
  useUnsavedChangesMock: vi.fn(() => ({
    contentRef: vi.fn(),
    requestClose: vi.fn(),
    dialogProps: { open: false, onClose: vi.fn(), onConfirm: vi.fn() },
  })),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("../actions", () => ({
  resetUserPassword: vi.fn(),
}));

vi.mock("@/shared/ui/UnsavedChangesDialog", () => ({
  default: () => <div data-unsaved-changes-dialog="admin" />,
  useUnsavedChanges: useUnsavedChangesMock,
}));

describe("ResetPasswordDialog", () => {
  beforeEach(() => {
    useUnsavedChangesMock.mockClear();
  });

  it("接入未保存修改关闭保护", () => {
    const html = renderToStaticMarkup(
      <ResetPasswordDialog userId="user-b" displayName="User B" onClose={() => {}} />,
    );

    expect(useUnsavedChangesMock).toHaveBeenCalledOnce();
    expect(html).toContain('data-unsaved-changes-dialog="admin"');
  });

  it("声明两次密码输入及认证边界", () => {
    const html = renderToStaticMarkup(
      <ResetPasswordDialog userId="user-b" displayName="User B" onClose={() => {}} />,
    );
    const inputs = html.match(/<input[^>]*type="password"[^>]*>/g) ?? [];

    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain('minLength="8"');
      expect(input).toContain('maxLength="128"');
      expect(input).toContain('autoComplete="new-password"');
      expect(input).toContain('required=""');
    }
    expect(inputs[0]).toContain('name="newPassword"');
    expect(inputs[0]).toContain('data-autofocus="true"');
    expect(inputs[1]).toContain('name="confirmPassword"');
    expect(html).toContain('noValidate=""');
    expect(html).toContain("text-left");
    expect(html).toContain("passwordHint");
    expect(html).toContain("resetSubmit");
  });

  it("中英文目录包含相同的重置密码文案", () => {
    const zh = zhMessages.admin.users as Record<string, string>;
    const en = enMessages.admin.users as Record<string, string>;
    const keys = [
      "resetButton",
      "resetTitle",
      "resetDescription",
      "newPassword",
      "confirmPassword",
      "passwordHint",
      "resetSubmit",
      "resetSuccess",
      "invalidPassword",
      "passwordMismatch",
      "selfResetForbidden",
      "resetFailed",
      "sessionRevokeFailed",
    ];

    for (const key of keys) {
      expect(zh[key]).toEqual(expect.any(String));
      expect(en[key]).toEqual(expect.any(String));
    }
  });
});
