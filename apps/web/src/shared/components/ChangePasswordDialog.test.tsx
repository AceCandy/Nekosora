import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh-CN.json";
import ChangePasswordDialog, {
  changeOwnPassword,
  classifyPasswordChangeError,
  validatePasswordChange,
} from "./ChangePasswordDialog";

const { changePasswordMock } = vi.hoisted(() => ({ changePasswordMock: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { changePassword: changePasswordMock },
}));

describe("ChangePasswordDialog", () => {
  beforeEach(() => {
    changePasswordMock.mockReset();
  });

  it("声明当前密码与两次新密码输入", () => {
    const html = renderToStaticMarkup(<ChangePasswordDialog open onClose={() => {}} />);
    const inputs = html.match(/<input[^>]*type="password"[^>]*>/g) ?? [];

    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toContain('name="currentPassword"');
    expect(inputs[0]).toContain('autoComplete="current-password"');
    expect(inputs[0]).toContain('data-autofocus="true"');
    for (const input of inputs.slice(1)) {
      expect(input).toContain('minLength="8"');
      expect(input).toContain('maxLength="128"');
      expect(input).toContain('autoComplete="new-password"');
    }
    expect(inputs[1]).toContain('name="newPassword"');
    expect(inputs[2]).toContain('name="confirmPassword"');
    expect(html).toContain('noValidate=""');
  });

  it("校验必填项、密码边界与确认值", () => {
    expect(validatePasswordChange("", "new-pass", "new-pass")).toBe("currentPasswordRequired");
    expect(validatePasswordChange("old-pass", "1234567", "1234567")).toBe("invalidPassword");
    expect(validatePasswordChange("old-pass", "x".repeat(129), "x".repeat(129))).toBe("invalidPassword");
    expect(validatePasswordChange("old-pass", "new-pass", "different")).toBe("passwordMismatch");
    expect(validatePasswordChange("old-pass", "new-pass", "new-pass")).toBeNull();
  });

  it("通过 Better Auth 修改当前密码并撤销其他会话", async () => {
    changePasswordMock.mockResolvedValue({ data: { token: "replacement-session" }, error: null });

    await changeOwnPassword("old-pass", "new-pass");

    expect(changePasswordMock).toHaveBeenCalledWith({
      currentPassword: "old-pass",
      newPassword: "new-pass",
      revokeOtherSessions: true,
    });
  });

  it("映射可修正的 Better Auth 密码错误", () => {
    expect(classifyPasswordChangeError("INVALID_PASSWORD")).toBe("invalidCurrentPassword");
    expect(classifyPasswordChangeError("PASSWORD_TOO_SHORT")).toBe("invalidPassword");
    expect(classifyPasswordChangeError("UNKNOWN")).toBe("changeFailed");
  });

  it("中英文目录包含相同的自助改密文案", () => {
    const zh = zhMessages.account as Record<string, string>;
    const en = enMessages.account as Record<string, string>;
    const keys = [
      "changePassword",
      "changePasswordTitle",
      "changePasswordDescription",
      "currentPassword",
      "newPassword",
      "confirmPassword",
      "passwordHint",
      "changePasswordSubmit",
      "changePasswordSuccess",
      "currentPasswordRequired",
      "invalidCurrentPassword",
      "invalidPassword",
      "passwordMismatch",
      "changeFailed",
    ];

    for (const key of keys) {
      expect(zh[key]).toEqual(expect.any(String));
      expect(en[key]).toEqual(expect.any(String));
    }
  });
});
