import { describe, expect, it } from "vitest";
import { resolveSeedAdminCredentials } from "./seed-admin";

describe("resolveSeedAdminCredentials", () => {
  it.each([
    ["未设置", undefined],
    ["仅空白", "   "],
    ["公开默认值", "change-me-on-first-login"],
    ["带空白的公开默认值", " change-me-on-first-login "],
  ])("生产环境拒绝%s的管理员密码", (_label, password) => {
    expect(() =>
      resolveSeedAdminCredentials({
        NODE_ENV: "production",
        SEED_ADMIN_PASSWORD: password,
      }),
    ).toThrow("生产环境必须显式设置安全的 SEED_ADMIN_PASSWORD");
  });

  it("生产环境保留显式安全凭据", () => {
    expect(
      resolveSeedAdminCredentials({
        NODE_ENV: "production",
        SEED_ADMIN_EMAIL: "admin@example.com",
        SEED_ADMIN_PASSWORD: "a-strong-bootstrap-password",
        SEED_ADMIN_NAME: "Operator",
      }),
    ).toEqual({
      email: "admin@example.com",
      password: "a-strong-bootstrap-password",
      name: "Operator",
    });
  });

  it("开发环境保留现有默认凭据", () => {
    expect(resolveSeedAdminCredentials({ NODE_ENV: "development" })).toEqual({
      email: "admin@nekusora.local",
      password: "change-me-on-first-login",
      name: "Administrator",
    });
  });
});
